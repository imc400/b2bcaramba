import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLevels, products, webhookEvents } from "@/db/schema";
import { getFulfillmentLocationId } from "./location";
import { syncProductFromShopify } from "./sync-product";

/**
 * Aplica un webhook de Shopify al espejo local.
 *
 * Única implementación: la usan la función Inngest (con retries por paso) y el
 * fallback inline del receptor HTTP cuando Inngest no está configurado.
 * Idempotente: los upserts se pueden repetir sin efectos secundarios.
 */
export async function applyShopifyWebhook(topic: string, payload: unknown): Promise<void> {
  switch (topic) {
    case "products/create":
    case "products/update": {
      const p = payload as { admin_graphql_api_id: string };
      await syncProductFromShopify(p.admin_graphql_api_id);
      return;
    }
    case "products/delete": {
      const p = payload as { id: number };
      await db.delete(products).where(eq(products.shopifyId, p.id));
      return;
    }
    case "inventory_levels/update":
    case "inventory_levels/connect": {
      const p = payload as {
        inventory_item_id: number;
        location_id: number;
        available: number | null;
        updated_at?: string;
      };
      // Las tiendas físicas y el 3PL no despachan pedidos B2B: su stock solo
      // agregaría ruido y podría confundir a quien lea la tabla.
      if (p.location_id !== getFulfillmentLocationId()) return;

      const updatedAt = p.updated_at ? new Date(p.updated_at) : new Date();
      const available = p.available ?? 0;
      await db
        .insert(inventoryLevels)
        .values({
          inventoryItemId: p.inventory_item_id,
          locationId: p.location_id,
          available,
          shopifyUpdatedAt: updatedAt,
        })
        .onConflictDoUpdate({
          target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId],
          set: { available, shopifyUpdatedAt: updatedAt, syncedAt: sql`now()` },
          // Los webhooks llegan fuera de orden: nunca pisar con un dato viejo
          setWhere: sql`${inventoryLevels.shopifyUpdatedAt} <= ${updatedAt.toISOString()}`,
        });
      return;
    }
    case "inventory_levels/disconnect": {
      // El producto dejó de manejarse en esa bodega. Sin esto quedaba stock
      // fantasma y el catálogo seguía ofreciendo unidades inexistentes.
      const p = payload as { inventory_item_id: number; location_id: number };
      if (p.location_id !== getFulfillmentLocationId()) return;
      await db
        .delete(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, p.inventory_item_id),
            eq(inventoryLevels.locationId, p.location_id),
          ),
        );
      return;
    }
    case "inventory_items/delete": {
      const p = payload as { id: number };
      await db.delete(inventoryLevels).where(eq(inventoryLevels.inventoryItemId, p.id));
      return;
    }
    default:
      // Topic no manejado (p.ej. inventory_items/update): no es error
      return;
  }
}

export async function markWebhookProcessed(webhookId: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.webhookId, webhookId));
}
