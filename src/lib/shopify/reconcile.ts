import "server-only";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  adminMagicLinks,
  adminSessions,
  emailEvents,
  otpCodes,
  rateLimits,
  sessions,
  syncState,
  webhookEvents,
} from "@/db/schema";
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
  podados: Record<string, number>;
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

  const podados = await podarTablasEfimeras();

  return { totalSynced, since, newCheckpoint, podados };
}

/**
 * Poda de tablas que crecen sin techo. `webhook_events` sumaba ~1.500 filas
 * diarias (30 mil en 18 días, ~600 mil al año) y solo sirve para deduplicar
 * reentregas de Shopify, que ocurren en minutos. Las demás guardan tokens y
 * ventanas de rate limit ya vencidos.
 *
 * Va pegado a la reconciliación horaria para no depender de otro cron.
 */
export async function podarTablasEfimeras(): Promise<Record<string, number>> {
  const dias = (n: number) => new Date(Date.now() - n * 24 * 3_600_000);
  const resultado: Record<string, number> = {};

  // El driver postgres.js devuelve el número de filas afectadas en `count`.
  const tareas: [string, () => Promise<unknown>][] = [
    ["webhook_events", () => db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, dias(30)))],
    ["otp_codes", () => db.delete(otpCodes).where(lt(otpCodes.expiresAt, dias(2)))],
    ["sessions", () => db.delete(sessions).where(lt(sessions.expiresAt, dias(7)))],
    ["admin_magic_links", () => db.delete(adminMagicLinks).where(lt(adminMagicLinks.expiresAt, dias(7)))],
    ["admin_sessions", () => db.delete(adminSessions).where(lt(adminSessions.expiresAt, dias(7)))],
    ["rate_limits", () => db.delete(rateLimits).where(lt(rateLimits.windowStart, dias(1)))],
    ["email_events", () => db.delete(emailEvents).where(lt(emailEvents.ocurridoEn, dias(180)))],
  ];

  for (const [nombre, ejecutar] of tareas) {
    try {
      const r = (await ejecutar()) as { count?: number } | undefined;
      const n = r?.count ?? 0;
      if (n > 0) resultado[nombre] = n;
    } catch (err) {
      // La poda es mantención: que falle no debe tumbar la reconciliación.
      console.error(`[poda] ${nombre} falló:`, err);
    }
  }
  return resultado;
}
