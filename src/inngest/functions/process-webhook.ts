import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  inventoryLevels,
  products,
  variants,
  webhookEvents,
} from "@/db/schema";
import { inngest, shopifyWebhookReceived } from "@/inngest/client";
import { numericId, PRODUCT_SYNC_QUERY } from "@/lib/shopify/operations";
import { shopifyAdmin } from "@/lib/shopify/client";

/**
 * Procesa webhooks de Shopify de forma durable.
 * Reglas: upserts idempotentes por ID, descartar eventos más viejos que el
 * estado guardado (los webhooks pueden llegar fuera de orden).
 */
export const processShopifyWebhook = inngest.createFunction(
  {
    id: "process-shopify-webhook",
    retries: 4,
    triggers: [shopifyWebhookReceived],
  },
  async ({ event, step }) => {
    const { topic, payload, webhookId } = event.data;

    switch (topic) {
      case "products/create":
      case "products/update": {
        const p = payload as { admin_graphql_api_id: string };
        await step.run("sync-product", () => syncProductFromShopify(p.admin_graphql_api_id));
        break;
      }
      case "products/delete": {
        const p = payload as { id: number };
        await step.run("delete-product", async () => {
          await db.delete(products).where(eq(products.shopifyId, p.id));
        });
        break;
      }
      case "inventory_levels/update": {
        const p = payload as {
          inventory_item_id: number;
          location_id: number;
          available: number | null;
          updated_at: string;
        };
        await step.run("upsert-inventory-level", async () => {
          const updatedAt = new Date(p.updated_at);
          await db
            .insert(inventoryLevels)
            .values({
              inventoryItemId: p.inventory_item_id,
              locationId: p.location_id,
              available: p.available ?? 0,
              shopifyUpdatedAt: updatedAt,
            })
            .onConflictDoUpdate({
              target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId],
              set: {
                available: p.available ?? 0,
                shopifyUpdatedAt: updatedAt,
                syncedAt: sql`now()`,
              },
              // Fuera de orden: solo aplicar si el evento es más nuevo
              setWhere: sql`${inventoryLevels.shopifyUpdatedAt} <= ${updatedAt.toISOString()}`,
            });
        });
        break;
      }
      case "inventory_items/delete": {
        const p = payload as { id: number };
        await step.run("delete-inventory-item", async () => {
          await db.delete(inventoryLevels).where(eq(inventoryLevels.inventoryItemId, p.id));
        });
        break;
      }
      default:
        // Topic no manejado: registrar y seguir (no es error)
        break;
    }

    await step.run("mark-processed", async () => {
      await db
        .update(webhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(webhookEvents.webhookId, webhookId));
    });
  },
);

/**
 * Sincroniza un producto completo desde la Admin API al espejo local.
 * Usado por webhooks products/create|update y por la reconciliación.
 */
export async function syncProductFromShopify(productGid: string): Promise<void> {
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
      status: "ACTIVE" | "ARCHIVED" | "DRAFT";
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
          inventoryItem: { id: string };
        }[];
      };
    } | null;
  };
  type ImageNode = { url: string; altText: string | null; width: number; height: number };

  const data = await shopifyAdmin<ProductPayload>(PRODUCT_SYNC_QUERY, { id: productGid });
  const p = data.product;
  if (!p) return; // eliminado entre el webhook y la consulta

  const productId = numericId(p.id);
  const images = p.media.nodes
    .map((n) => ("image" in n ? n.image : null))
    .filter((i): i is ImageNode => i !== null);

  await db.transaction(async (tx) => {
    await tx
      .insert(products)
      .values({
        shopifyId: productId,
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        vendor: p.vendor,
        productType: p.productType,
        category: p.category?.fullName ?? null,
        tags: p.tags,
        status: p.status,
        featuredImageUrl: p.featuredMedia?.image?.url ?? images[0]?.url ?? null,
        images,
        shopifyUpdatedAt: new Date(p.updatedAt),
      })
      .onConflictDoUpdate({
        target: products.shopifyId,
        set: {
          handle: p.handle,
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          vendor: p.vendor,
          productType: p.productType,
          category: p.category?.fullName ?? null,
          tags: p.tags,
          status: p.status,
          featuredImageUrl: p.featuredMedia?.image?.url ?? images[0]?.url ?? null,
          images,
          shopifyUpdatedAt: new Date(p.updatedAt),
          syncedAt: sql`now()`,
        },
      });

    const variantIds: number[] = [];
    for (const v of p.variants.nodes) {
      const variantId = numericId(v.id);
      variantIds.push(variantId);
      await tx
        .insert(variants)
        .values({
          shopifyId: variantId,
          productId,
          inventoryItemId: numericId(v.inventoryItem.id),
          title: v.title,
          sku: v.sku,
          priceClp: Math.round(Number(v.price)),
          compareAtPriceClp: v.compareAtPrice ? Math.round(Number(v.compareAtPrice)) : null,
          position: v.position,
          imageUrl: v.image?.url ?? null,
          availableForSale: v.availableForSale,
          shopifyUpdatedAt: new Date(v.updatedAt),
        })
        .onConflictDoUpdate({
          target: variants.shopifyId,
          set: {
            productId,
            inventoryItemId: numericId(v.inventoryItem.id),
            title: v.title,
            sku: v.sku,
            priceClp: Math.round(Number(v.price)),
            compareAtPriceClp: v.compareAtPrice ? Math.round(Number(v.compareAtPrice)) : null,
            position: v.position,
            imageUrl: v.image?.url ?? null,
            availableForSale: v.availableForSale,
            shopifyUpdatedAt: new Date(v.updatedAt),
            syncedAt: sql`now()`,
          },
        });
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
