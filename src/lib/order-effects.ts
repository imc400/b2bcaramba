import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  collaborators,
  companies,
  inventoryLevels,
  notificationRecipients,
  orderItems,
  orders,
} from "@/db/schema";
import {
  orderConfirmationHtml,
  orderNotificationHtml,
  sendEmail,
} from "@/lib/email/send";
import { adjustInventory, getInventoryQuantities } from "@/lib/shopify/operations";
import { getFulfillmentLocationId } from "@/lib/shopify/location";
import { getAdminAccessToken } from "@/lib/shopify/token";

/**
 * Efectos post-pedido compartidos entre la función Inngest (con retries por
 * paso) y el fallback inline (cuando INNGEST_EVENT_KEY no está configurada).
 * Única fuente de verdad de esta lógica: no duplicar en otros módulos.
 */

export type OrderBundle = {
  order: typeof orders.$inferSelect;
  company: typeof companies.$inferSelect;
  campaign: typeof campaigns.$inferSelect;
  collaborator: typeof collaborators.$inferSelect;
  items: (typeof orderItems.$inferSelect)[];
};

export async function loadOrderBundle(orderId: string): Promise<OrderBundle> {
  const [row] = await db
    .select({
      order: orders,
      company: companies,
      campaign: campaigns,
      collaborator: collaborators,
    })
    .from(orders)
    .innerJoin(companies, eq(orders.companyId, companies.id))
    .innerJoin(campaigns, eq(orders.campaignId, campaigns.id))
    .innerJoin(collaborators, eq(orders.collaboratorId, collaborators.id))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error(`Pedido ${orderId} no existe`);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { ...row, items };
}

/**
 * ¿Está habilitado el ajuste de stock REAL en Shopify?
 * Gate explícito (SHOPIFY_STOCK_ADJUST_ENABLED=true) para que un pedido de
 * prueba en desarrollo jamás toque el inventario de la tienda en producción.
 */
export function isShopifyAdjustEnabled(): boolean {
  return process.env.SHOPIFY_STOCK_ADJUST_ENABLED === "true";
}

const MAX_INTENTOS_AJUSTE = 3;

/** Shopify rechaza el ajuste completo cuando el stock cambió bajo nuestros pies. */
function esErrorDeCarrera(err: unknown): boolean {
  return /changeFromQuantity|no longer matches|persisted quantity/i.test(String(err));
}

/**
 * Ajusta el stock del pedido en Shopify (bodega de despacho).
 *
 * Desde la API 2026-07 el ajuste es un compare-and-swap: hay que declarar la
 * cantidad que creemos que hay (`changeFromQuantity`), y Shopify rechaza la
 * mutación COMPLETA —sin escribir nada— si el valor ya no coincide. Ese
 * rechazo atómico es nuestra garantía de exactamente-una-vez:
 *
 *  - Si el ajuste falla por carrera, sabemos que no se aplicó: releemos y
 *    reintentamos con el valor fresco (la venta B2C se llevó unidades).
 *  - Si nos quedamos sin respuesta (timeout) y al reintentar el CAS falla,
 *    comparamos contra la cantidad esperada: si coincide, nuestra escritura sí
 *    había llegado y no hay nada que repetir.
 *
 * La directiva @idempotent (obligatoria desde 2026-04) cubre además el caso de
 * dos entregas simultáneas del mismo request.
 */
async function applyInventoryDelta(
  bundle: OrderBundle,
  signo: 1 | -1,
  reason: "correction" | "restock",
): Promise<void> {
  const locationId = getFulfillmentLocationId();
  const itemIds = bundle.items.map((i) => i.inventoryItemId);
  const referenceUri = `${process.env.NEXT_PUBLIC_APP_URL}/admin/pedidos/${bundle.order.id}`;

  for (let intento = 1; intento <= MAX_INTENTOS_AJUSTE; intento++) {
    const actuales = await getInventoryQuantities(itemIds, locationId);
    if (actuales.size !== itemIds.length) {
      throw new Error(
        `[order ${bundle.order.code}] hay ítems sin inventario en la bodega ${locationId}`,
      );
    }

    const cambios = bundle.items.map((i) => ({
      inventoryItemId: i.inventoryItemId,
      locationId,
      delta: signo * i.quantity,
      changeFromQuantity: actuales.get(i.inventoryItemId)!,
    }));
    const esperadas = new Map(
      cambios.map((c) => [c.inventoryItemId, c.changeFromQuantity + c.delta]),
    );

    try {
      await adjustInventory(
        cambios,
        reason,
        referenceUri,
        `caramba-order-${bundle.order.id}-${reason}-${intento}`,
      );
    } catch (err) {
      if (!esErrorDeCarrera(err)) throw err;

      // ¿Falló porque nuestra propia escritura ya había llegado (timeout)?
      const despues = await getInventoryQuantities(itemIds, locationId);
      const yaAplicado = [...esperadas].every(([id, q]) => despues.get(id) === q);
      if (yaAplicado) {
        console.warn(`[order ${bundle.order.code}] el ajuste ya estaba aplicado, no se repite`);
      } else if (intento < MAX_INTENTOS_AJUSTE) {
        console.warn(
          `[order ${bundle.order.code}] venta B2C simultánea cambió el stock; reintento ${intento + 1}`,
        );
        continue;
      } else {
        throw err;
      }
    }

    // `quantityAfterChange` de la respuesta puede venir null: releemos la
    // cantidad real para detectar de verdad un stock negativo (oversell).
    const finales = await getInventoryQuantities(itemIds, locationId);
    const negativo = [...finales.entries()].find(([, cantidad]) => cantidad < 0);
    if (negativo) {
      await db
        .update(orders)
        .set({
          status: "requiere_revision",
          stockIssue: {
            variantId: negativo[0],
            resultingQuantity: negativo[1],
            detectedAt: new Date().toISOString(),
          },
        })
        .where(eq(orders.id, bundle.order.id));
    }
    return;
  }
}

export async function adjustShopifyForOrder(bundle: OrderBundle): Promise<void> {
  if (!isShopifyAdjustEnabled()) {
    console.warn(
      `[order ${bundle.order.code}] SHOPIFY_STOCK_ADJUST_ENABLED != true: ajuste remoto omitido (espejo local ya descontado)`,
    );
    return;
  }
  if (!(await getAdminAccessToken())) {
    console.warn(`[order ${bundle.order.code}] sin token Admin: ajuste remoto omitido`);
    return;
  }
  await applyInventoryDelta(bundle, -1, "correction");
}

/** Repone el stock de un pedido anulado (espejo + Shopify). */
export async function restockOrder(orderId: string): Promise<void> {
  const bundle = await loadOrderBundle(orderId);
  const locationId = getFulfillmentLocationId();

  // Espejo local siempre
  for (const item of bundle.items) {
    await db
      .update(inventoryLevels)
      .set({ available: sql`${inventoryLevels.available} + ${item.quantity}` })
      .where(
        and(
          eq(inventoryLevels.inventoryItemId, item.inventoryItemId),
          eq(inventoryLevels.locationId, locationId),
        ),
      );
  }

  if (!isShopifyAdjustEnabled()) {
    console.warn(`[order ${bundle.order.code}] restock remoto omitido (gate desactivado)`);
    return;
  }
  if (!(await getAdminAccessToken())) return;
  await applyInventoryDelta(bundle, 1, "restock");
}

/** Notifica el pedido a los destinatarios configurados (global + empresa). */
export async function notifyOrderRecipients(bundle: OrderBundle): Promise<void> {
  const recipients = await db
    .select({ email: notificationRecipients.email })
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.active, true),
        or(
          isNull(notificationRecipients.companyId),
          eq(notificationRecipients.companyId, bundle.order.companyId),
        ),
      ),
    );
  if (recipients.length === 0) return;

  await sendEmail({
    to: recipients.map((r) => r.email),
    subject: `Nuevo pedido ${bundle.order.code} · ${bundle.company.name}`,
    html: orderNotificationHtml({
      code: bundle.order.code,
      companyName: bundle.company.name,
      collaboratorName: bundle.collaborator.name ?? bundle.order.recipientName,
      recipientName: bundle.order.recipientName,
      phone: bundle.order.phone,
      addressLine: bundle.order.addressLine,
      comuna: bundle.order.comuna,
      items: bundle.items.map((i) => ({
        title: i.productTitle,
        variantTitle: i.variantTitle,
        quantity: i.quantity,
      })),
    }),
  });
}

/** Confirmación al colaborador (si dejó correo). */
export async function confirmOrderToCollaborator(bundle: OrderBundle): Promise<void> {
  if (!bundle.order.email) return;
  await sendEmail({
    to: [bundle.order.email],
    subject: `Tu pedido ${bundle.order.code} está confirmado`,
    html: orderConfirmationHtml({
      code: bundle.order.code,
      collaboratorName: bundle.collaborator.name ?? bundle.order.recipientName,
      items: bundle.items.map((i) => ({ title: i.productTitle, quantity: i.quantity })),
    }),
  });
}

/**
 * Fallback inline cuando no hay Inngest: ejecuta todos los efectos tolerando
 * fallos parciales (el pedido nunca se pierde por un efecto fallido).
 */
export async function runOrderEffectsInline(orderId: string): Promise<void> {
  let bundle: OrderBundle;
  try {
    bundle = await loadOrderBundle(orderId);
  } catch (err) {
    console.error(`[order-effects ${orderId}] no se pudo cargar:`, err);
    return;
  }
  for (const [name, fn] of [
    ["adjust", () => adjustShopifyForOrder(bundle)],
    ["notify", () => notifyOrderRecipients(bundle)],
    ["confirm", () => confirmOrderToCollaborator(bundle)],
  ] as const) {
    try {
      await fn();
    } catch (err) {
      console.error(`[order-effects ${bundle.order.code}] paso ${name} falló:`, err);
    }
  }
}
