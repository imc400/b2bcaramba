import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  collaborators,
  companies,
  notificationRecipients,
  orderItems,
  orders,
} from "@/db/schema";
import {
  orderConfirmationHtml,
  orderNotificationHtml,
  sendEmail,
} from "@/lib/email/send";
import { adjustInventory } from "@/lib/shopify/operations";
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

/**
 * Descuenta el stock del pedido en Shopify (bodega de despacho).
 * Si alguna cantidad queda negativa (carrera con la venta B2C), marca el
 * pedido como requiere_revision.
 */
export async function adjustShopifyForOrder(bundle: OrderBundle): Promise<void> {
  if (!isShopifyAdjustEnabled()) {
    console.warn(
      `[order ${bundle.order.code}] SHOPIFY_STOCK_ADJUST_ENABLED != true: ajuste remoto omitido (espejo local ya descontado)`,
    );
    return;
  }
  const token = await getAdminAccessToken();
  if (!token) {
    console.warn(`[order ${bundle.order.code}] sin token Admin: ajuste remoto omitido`);
    return;
  }
  const locationId = getFulfillmentLocationId();

  const results = await adjustInventory(
    bundle.items.map((i) => ({
      inventoryItemId: i.inventoryItemId,
      locationId,
      delta: -i.quantity,
    })),
    "correction",
    `${process.env.NEXT_PUBLIC_APP_URL}/admin/pedidos/${bundle.order.id}`,
  );

  const negative = results.find((r) => r.resultingQuantity < 0);
  if (negative) {
    await db
      .update(orders)
      .set({
        status: "requiere_revision",
        stockIssue: {
          variantId: negative.inventoryItemId,
          resultingQuantity: negative.resultingQuantity,
          detectedAt: new Date().toISOString(),
        },
      })
      .where(eq(orders.id, bundle.order.id));
  }
}

/** Repone el stock de un pedido anulado (espejo + Shopify). */
export async function restockOrder(orderId: string): Promise<void> {
  const bundle = await loadOrderBundle(orderId);
  const locationId = getFulfillmentLocationId();

  // Espejo local siempre
  const { inventoryLevels } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
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
  const token = await getAdminAccessToken();
  if (!token) return;
  await adjustInventory(
    bundle.items.map((i) => ({
      inventoryItemId: i.inventoryItemId,
      locationId,
      delta: i.quantity,
    })),
    "restock",
    `${process.env.NEXT_PUBLIC_APP_URL}/admin/pedidos/${orderId}`,
  );
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
