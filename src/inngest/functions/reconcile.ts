import { eq } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/db";
import { syncState } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { shopifyAdmin } from "@/lib/shopify/client";
import { RECONCILIATION_QUERY } from "@/lib/shopify/operations";
import { syncProductFromShopify } from "./process-webhook";

const CHECKPOINT_KEY = "reconciliation_checkpoint";
// Margen de solapamiento para no perder eventos en el borde del checkpoint
const OVERLAP_MS = 5 * 60 * 1000;

/**
 * Reconciliación incremental: los webhooks se pueden perder ("delivery isn't
 * always guaranteed" — shopify.dev). Cada hora consultamos productos con
 * updated_at >= último checkpoint y re-sincronizamos los que cambiaron.
 */
export const reconcileCatalog = inngest.createFunction(
  {
    id: "reconcile-catalog",
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [cron("0 * * * *")], // cada hora
  },
  async ({ step }) => {
    const checkpoint = await step.run("load-checkpoint", async () => {
      const row = await db.query.syncState.findFirst({
        where: eq(syncState.key, CHECKPOINT_KEY),
      });
      const stored = (row?.value as { iso?: string } | undefined)?.iso;
      // Sin checkpoint: mirar 24h hacia atrás
      return stored ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    });

    const since = new Date(new Date(checkpoint).getTime() - OVERLAP_MS).toISOString();
    const newCheckpoint = new Date().toISOString();

    // Recorrer todas las páginas de productos modificados
    let cursor: string | null = null;
    let totalSynced = 0;
    let page = 0;
    do {
      page++;
      const result: {
        gids: string[];
        nextCursor: string | null;
      } = await step.run(`fetch-changed-page-${page}`, async () => {
        const data = await shopifyAdmin<{
          products: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: { id: string; updatedAt: string }[];
          };
        }>(RECONCILIATION_QUERY, {
          query: `updated_at:>='${since}'`,
          cursor,
        });
        return {
          gids: data.products.nodes.map((n) => n.id),
          nextCursor: data.products.pageInfo.hasNextPage
            ? data.products.pageInfo.endCursor
            : null,
        };
      });

      for (const gid of result.gids) {
        await step.run(`sync-${gid.split("/").pop()}`, () => syncProductFromShopify(gid));
        totalSynced++;
      }
      cursor = result.nextCursor;
    } while (cursor);

    await step.run("save-checkpoint", async () => {
      await db
        .insert(syncState)
        .values({ key: CHECKPOINT_KEY, value: { iso: newCheckpoint } })
        .onConflictDoUpdate({
          target: syncState.key,
          set: { value: { iso: newCheckpoint }, updatedAt: new Date() },
        });
    });

    return { totalSynced, since, newCheckpoint };
  },
);
