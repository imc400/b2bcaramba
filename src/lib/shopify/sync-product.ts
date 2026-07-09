import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLevels, products, variants } from "@/db/schema";
import { shopifyAdmin } from "./client";
import { getFulfillmentLocationId } from "./location";
import { numericId, PRODUCT_SYNC_QUERY } from "./operations";

type ImageNode = { url: string; altText: string | null; width: number; height: number };

type ProductPayload = {
  product: {
    id: string;
    handle: string;
    title: string;
    descriptionHtml: string | null;
    vendor: string | null;
    productType: string | null;
    category: { fullName: string } | null;
    tags: string[];
    status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
    updatedAt: string;
    featuredMedia: { image: ImageNode | null } | null;
    media: { nodes: ({ image: ImageNode | null } | Record<string, never>)[] };
    variants: {
      nodes: {
        id: string;
        title: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
        position: number;
        availableForSale: boolean;
        updatedAt: string;
        image: { url: string } | null;
        inventoryItem: {
          id: string;
          inventoryLevels: {
            nodes: {
              location: { id: string };
              quantities: { name: string; quantity: number }[];
              updatedAt: string;
            }[];
          };
        };
      }[];
    };
  } | null;
};

/**
 * Sincroniza un producto completo (datos + stock de la bodega de despacho)
 * desde la Admin API al espejo local.
 *
 * Única implementación del mapeo Shopify → espejo por producto: la usan los
 * webhooks products/create|update, la reconciliación horaria y el fallback
 * inline. Idempotente y segura ante eventos fuera de orden.
 */
export async function syncProductFromShopify(productGid: string): Promise<void> {
  const data = await shopifyAdmin<ProductPayload>(PRODUCT_SYNC_QUERY, { id: productGid });
  const p = data.product;
  if (!p) return; // eliminado entre el webhook y la consulta

  const productId = numericId(p.id);
  const locationId = getFulfillmentLocationId();
  const images = p.media.nodes
    .map((n) => ("image" in n ? n.image : null))
    .filter((i): i is ImageNode => i !== null);
  const featuredImageUrl = p.featuredMedia?.image?.url ?? images[0]?.url ?? null;

  await db.transaction(async (tx) => {
    const productValues = {
      shopifyId: productId,
      handle: p.handle,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      vendor: p.vendor,
      productType: p.productType,
      category: p.category?.fullName ?? null,
      tags: p.tags,
      status: p.status,
      featuredImageUrl,
      images,
      shopifyUpdatedAt: new Date(p.updatedAt),
    };
    await tx
      .insert(products)
      .values(productValues)
      .onConflictDoUpdate({
        target: products.shopifyId,
        set: { ...productValues, syncedAt: sql`now()` },
      });

    const variantIds: number[] = [];
    for (const v of p.variants.nodes) {
      const variantId = numericId(v.id);
      const inventoryItemId = numericId(v.inventoryItem.id);
      variantIds.push(variantId);

      const variantValues = {
        shopifyId: variantId,
        productId,
        inventoryItemId,
        title: v.title,
        sku: v.sku,
        priceClp: Math.round(Number(v.price)),
        compareAtPriceClp: v.compareAtPrice ? Math.round(Number(v.compareAtPrice)) : null,
        position: v.position,
        imageUrl: v.image?.url ?? null,
        availableForSale: v.availableForSale,
        shopifyUpdatedAt: new Date(v.updatedAt),
      };
      await tx
        .insert(variants)
        .values(variantValues)
        .onConflictDoUpdate({
          target: variants.shopifyId,
          set: { ...variantValues, syncedAt: sql`now()` },
        });

      // Stock: solo la bodega que despacha online
      const level = v.inventoryItem.inventoryLevels.nodes.find(
        (n) => numericId(n.location.id) === locationId,
      );
      if (level) {
        const available = level.quantities.find((q) => q.name === "available")?.quantity ?? 0;
        const updatedAt = new Date(level.updatedAt);
        await tx
          .insert(inventoryLevels)
          .values({ inventoryItemId, locationId, available, shopifyUpdatedAt: updatedAt })
          .onConflictDoUpdate({
            target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId],
            set: { available, shopifyUpdatedAt: updatedAt, syncedAt: sql`now()` },
            // Nunca pisar el espejo con un dato más viejo que el que tenemos
            setWhere: sql`${inventoryLevels.shopifyUpdatedAt} <= ${updatedAt.toISOString()}`,
          });
      }
    }

    // Variantes eliminadas en Shopify
    if (variantIds.length > 0) {
      await tx.execute(sql`
        DELETE FROM variants
        WHERE product_id = ${productId}
          AND shopify_id NOT IN ${sql.raw(`(${variantIds.join(",")})`)}
      `);
    }
  });
}
