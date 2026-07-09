import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  collaborators,
  inventoryLevels,
  orderItems,
  orders,
  products,
  variants,
} from "@/db/schema";
import { inngest, orderCreated } from "@/inngest/client";
import { isCampaignOpen } from "./campaign";
import { getOrderableVariantIds } from "./catalog";
import { runOrderEffectsInline } from "./order-effects";
import { getFulfillmentLocationId } from "./shopify/location";

export type CreateOrderInput = {
  collaboratorId: string;
  campaignId: string;
  companyId: string;
  variantIds: number[]; // una unidad por variante (cupo = n regalos)
  recipientName: string;
  phone: string;
  email: string | null;
  addressLine: string;
  comuna: string;
  region: string | null;
  addressNotes: string | null;
};

export type CreateOrderResult =
  | { ok: true; orderId: string; code: string }
  | {
      ok: false;
      error:
        | "cupo_excedido"
        | "sin_stock"
        | "campana_cerrada"
        | "seleccion_vacia"
        | "seleccion_invalida"
        | "fuera_de_catalogo";
      detail?: string;
    };

/**
 * Crea un pedido de forma transaccional:
 * 1. Valida campaña activa, cupo disponible y stock espejo (con lock).
 * 2. Descuenta el espejo local (efecto inmediato para otros colaboradores).
 * 3. Genera código correlativo CB-<año>-<n>.
 * El ajuste en Shopify y los correos ocurren de forma durable vía Inngest.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (input.variantIds.length === 0) return { ok: false, error: "seleccion_vacia" };

  // IDs repetidos burlarían el chequeo de stock (se validaría la misma fila N
  // veces y se descontaría N unidades). Un regalo = una variante distinta.
  const variantIds = [...new Set(input.variantIds)];
  if (variantIds.length !== input.variantIds.length) {
    return { ok: false, error: "seleccion_invalida", detail: "regalos repetidos" };
  }

  const result = await db.transaction(async (tx): Promise<CreateOrderResult> => {
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId));
    if (!campaign || !isCampaignOpen(campaign)) {
      return { ok: false, error: "campana_cerrada" };
    }

    // Autorización: las variantes deben pertenecer al catálogo de ESTA campaña
    // (filtro de precio/tags/curaduría, producto activo, stock de seguridad).
    // Sin esto, un cliente manipulado podría pedir cualquier variante de la
    // tienda — incluso una fuera del presupuesto acordado con la empresa.
    const permitidas = await getOrderableVariantIds(
      variantIds,
      campaign.catalogFilter,
      campaign.safetyStock,
    );
    const noPermitida = variantIds.find((id) => !permitidas.has(id));
    if (noPermitida !== undefined) {
      return {
        ok: false,
        error: "fuera_de_catalogo",
        detail: `variante ${noPermitida} no está en el catálogo de la campaña`,
      };
    }

    // Lock del colaborador: serializa pedidos simultáneos del mismo usuario
    const [collab] = await tx
      .select()
      .from(collaborators)
      .where(eq(collaborators.id, input.collaboratorId))
      .for("update");
    if (!collab) return { ok: false, error: "cupo_excedido" };

    const [used] = await tx
      .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int` })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.collaboratorId, input.collaboratorId),
          sql`${orders.status} != 'anulado'`,
        ),
      );
    const remaining = collab.quota - (used?.n ?? 0);
    if (variantIds.length > remaining) {
      return { ok: false, error: "cupo_excedido", detail: `cupo restante: ${remaining}` };
    }

    // Una sola query bloquea las filas de inventario de todas las variantes.
    // ORDER BY inventory_item_id es CRÍTICO: dos pedidos concurrentes que
    // pidan los mismos productos en distinto orden se bloquearían mutuamente
    // (deadlock) si cada uno tomara los locks en el orden de su carrito.
    const lines = await tx
      .select({
        variantId: variants.shopifyId,
        productId: products.shopifyId,
        inventoryItemId: variants.inventoryItemId,
        locationId: inventoryLevels.locationId,
        available: inventoryLevels.available,
        title: products.title,
        variantTitle: variants.title,
        imageUrl: sql<string | null>`coalesce(${variants.imageUrl}, ${products.featuredImageUrl})`,
        priceClp: variants.priceClp,
      })
      .from(variants)
      .innerJoin(products, eq(products.shopifyId, variants.productId))
      .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
      .where(
        and(
          inArray(variants.shopifyId, variantIds),
          // Stock de la bodega que despacha, no el de las tiendas físicas
          eq(inventoryLevels.locationId, getFulfillmentLocationId()),
        ),
      )
      .orderBy(asc(variants.inventoryItemId))
      .for("update", { of: inventoryLevels });

    if (lines.length !== variantIds.length) {
      return { ok: false, error: "sin_stock", detail: "producto sin inventario en la bodega" };
    }
    const agotada = lines.find((l) => l.available < 1);
    if (agotada) return { ok: false, error: "sin_stock", detail: agotada.title };

    // Descuento inmediato del espejo (Shopify se ajusta async vía Inngest)
    for (const line of lines) {
      await tx
        .update(inventoryLevels)
        .set({ available: sql`${inventoryLevels.available} - 1` })
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, line.inventoryItemId),
            eq(inventoryLevels.locationId, line.locationId),
          ),
        );
    }

    // Código correlativo por año (lock por advisory para evitar duplicados)
    const year = new Date().getFullYear();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('order_code_' || ${year}))`);
    const [seq] = await tx
      .select({ n: sql<number>`count(*)::int + 1` })
      .from(orders)
      .where(sql`extract(year from ${orders.createdAt}) = ${year}`);
    const code = `CB-${year}-${String(seq?.n ?? 1).padStart(5, "0")}`;

    const [order] = await tx
      .insert(orders)
      .values({
        code,
        companyId: input.companyId,
        campaignId: input.campaignId,
        collaboratorId: input.collaboratorId,
        recipientName: input.recipientName,
        phone: input.phone,
        email: input.email,
        addressLine: input.addressLine,
        comuna: input.comuna,
        region: input.region,
        addressNotes: input.addressNotes,
      })
      .returning();

    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        productShopifyId: l.productId,
        variantShopifyId: l.variantId,
        inventoryItemId: l.inventoryItemId,
        productTitle: l.title,
        variantTitle: l.variantTitle,
        imageUrl: l.imageUrl,
        priceClp: l.priceClp,
        quantity: 1,
      })),
    );

    return { ok: true, orderId: order.id, code };
  });

  if (result.ok) {
    // Efectos fuera de la transacción: ajuste de stock en Shopify + correos.
    // Con Inngest configurado van por cola durable (retries por paso); sin
    // Inngest corren inline. El pedido NUNCA falla por un efecto fallido.
    if (process.env.INNGEST_EVENT_KEY) {
      try {
        await inngest.send(orderCreated.create({ orderId: result.orderId }));
      } catch (err) {
        console.error(`[order ${result.code}] inngest.send falló, corriendo inline:`, err);
        await runOrderEffectsInline(result.orderId);
      }
    } else {
      await runOrderEffectsInline(result.orderId);
    }
  }
  return result;
}

/** Cupo restante de un colaborador (cupo - regalos ya pedidos no anulados). */
export async function getRemainingQuota(collaboratorId: string): Promise<number> {
  const [collab] = await db
    .select({ quota: collaborators.quota })
    .from(collaborators)
    .where(eq(collaborators.id, collaboratorId));
  if (!collab) return 0;
  const [used] = await db
    .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int` })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(eq(orders.collaboratorId, collaboratorId), sql`${orders.status} != 'anulado'`),
    );
  return Math.max(0, collab.quota - (used?.n ?? 0));
}
