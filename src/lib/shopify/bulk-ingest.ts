import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLevels, products, variants } from "@/db/schema";
import { parseBulkCatalogLines } from "./bulk-parse";
export { parseBulkCatalogLines } from "./bulk-parse";

/**
 * Ingesta del JSONL de una Bulk Operation (BULK_CATALOG_QUERY).
 * El JSONL trae un objeto por línea; los hijos referencian al padre vía
 * __parentId (variants → product, inventory levels → variant anidado).
 */

const CHUNK = 500;

/**
 * Descarga el JSONL de la bulk operation y sincroniza el espejo completo:
 * upsert masivo + eliminación de productos que ya no existen en Shopify.
 */
export async function ingestBulkCatalog(jsonlUrl: string): Promise<{
  products: number;
  variants: number;
  levels: number;
  deletedProducts: number;
}> {
  const res = await fetch(jsonlUrl);
  if (!res.ok) throw new Error(`Descarga del JSONL falló: HTTP ${res.status}`);
  const text = await res.text();
  const parsed = parseBulkCatalogLines(text.split("\n"));
  let deletedCount = 0;

  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.products.length; i += CHUNK) {
      const chunk = parsed.products.slice(i, i + CHUNK);
      await tx
        .insert(products)
        .values(chunk)
        .onConflictDoUpdate({
          target: products.shopifyId,
          set: {
            handle: sql`excluded.handle`,
            title: sql`excluded.title`,
            descriptionHtml: sql`excluded.description_html`,
            vendor: sql`excluded.vendor`,
            productType: sql`excluded.product_type`,
            category: sql`excluded.category`,
            tags: sql`excluded.tags`,
            status: sql`excluded.status`,
            featuredImageUrl: sql`excluded.featured_image_url`,
            images: sql`excluded.images`,
            shopifyUpdatedAt: sql`excluded.shopify_updated_at`,
            syncedAt: sql`now()`,
          },
        });
    }

    for (let i = 0; i < parsed.variants.length; i += CHUNK) {
      const chunk = parsed.variants.slice(i, i + CHUNK);
      await tx
        .insert(variants)
        .values(chunk)
        .onConflictDoUpdate({
          target: variants.shopifyId,
          set: {
            productId: sql`excluded.product_id`,
            inventoryItemId: sql`excluded.inventory_item_id`,
            title: sql`excluded.title`,
            sku: sql`excluded.sku`,
            priceClp: sql`excluded.price_clp`,
            compareAtPriceClp: sql`excluded.compare_at_price_clp`,
            position: sql`excluded.position`,
            imageUrl: sql`excluded.image_url`,
            availableForSale: sql`excluded.available_for_sale`,
            shopifyUpdatedAt: sql`excluded.shopify_updated_at`,
            syncedAt: sql`now()`,
          },
        });
    }

    for (let i = 0; i < parsed.levels.length; i += CHUNK) {
      const chunk = parsed.levels.slice(i, i + CHUNK);
      await tx
        .insert(inventoryLevels)
        .values(chunk)
        .onConflictDoUpdate({
          target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId],
          set: {
            available: sql`excluded.available`,
            shopifyUpdatedAt: sql`excluded.shopify_updated_at`,
            syncedAt: sql`now()`,
          },
        });
    }

    // Productos eliminados en Shopify: ya no vienen en el bulk
    if (parsed.products.length > 0) {
      const ids = parsed.products.map((p) => p.shopifyId);
      const deleted = await tx.execute(sql`
        DELETE FROM products
        WHERE shopify_id NOT IN ${sql.raw(`(${ids.join(",")})`)}
        RETURNING shopify_id
      `);
      deletedCount = deleted.length;
    }
  });

  return {
    products: parsed.products.length,
    variants: parsed.variants.length,
    levels: parsed.levels.length,
    deletedProducts: deletedCount,
  };
}
