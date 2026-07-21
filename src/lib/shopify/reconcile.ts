import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncState } from "@/db/schema";
import { shopifyAdmin } from "@/lib/shopify/client";
import { RECONCILIATION_QUERY } from "@/lib/shopify/operations";
import { syncProductFromShopify } from "@/lib/shopify/sync-product";

const CHECKPOINT_KEY = "reconciliation_checkpoint";
// Margen de solapamiento para no perder eventos en el borde del checkpoint.
const OVERLAP_MS = 5 * 60 * 1000;

/**
 * Reconciliación incremental del catálogo. Los webhooks se pueden perder
 * ("delivery isn't always guaranteed" — shopify.dev): consultamos productos con
 * updated_at >= último checkpoint y re-sincronizamos los que cambiaron.
 *
 * Núcleo compartido por el cron de Inngest (src/inngest/functions/reconcile.ts)
 * y el Vercel Cron (src/app/api/cron/reconcile/route.ts) — una sola fuente de
 * verdad. Es idempotente: syncProductFromShopify upsertea con guarda por
 * timestamp, así que reejecutar desde el checkpoint no duplica ni pisa datos.
 */
export async function reconcileCatalogCore(): Promise<{
  totalSynced: number;
  since: string;
  newCheckpoint: string;
}> {
  const row = await db.query.syncState.findFirst({ where: eq(syncState.key, CHECKPOINT_KEY) });
  const stored = (row?.value as { iso?: string } | undefined)?.iso;
  // Sin checkpoint: mirar 24h hacia atrás.
  const checkpoint = stored ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const since = new Date(new Date(checkpoint).getTime() - OVERLAP_MS).toISOString();
  const newCheckpoint = new Date().toISOString();

  let cursor: string | null = null;
  let totalSynced = 0;
  do {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { id: string; updatedAt: string }[];
      };
    } = await shopifyAdmin(RECONCILIATION_QUERY, { query: `updated_at:>='${since}'`, cursor });

    for (const node of data.products.nodes) {
      await syncProductFromShopify(node.id);
      totalSynced++;
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  await db
    .insert(syncState)
    .values({ key: CHECKPOINT_KEY, value: { iso: newCheckpoint } })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { value: { iso: newCheckpoint }, updatedAt: new Date() },
    });

  return { totalSynced, since, newCheckpoint };
}
