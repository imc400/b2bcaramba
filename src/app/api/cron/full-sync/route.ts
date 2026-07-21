import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ingestBulkCatalog } from "@/lib/shopify/bulk-ingest";
import { getBulkOperationStatus, startBulkCatalogSync } from "@/lib/shopify/operations";

// Capa 3 del espejo: full-resync semanal por Bulk Operations vía Vercel Cron
// (fallback cuando Inngest no está conectado). Schedule en vercel.json:
// "0 5 * * 0" (domingo 05:00 UTC ≈ 01:00 Chile).
//
// El bulk de Shopify tarda minutos; polleamos dentro de la ventana de la
// función. Si no alcanza a terminar, la reconciliación horaria cubre el
// incremental y el próximo full-sync reintenta — no se pierde consistencia.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 18; // ~4.5 min, holgado dentro de maxDuration=300

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const operationId = await startBulkCatalogSync();

    let status: Awaited<ReturnType<typeof getBulkOperationStatus>> = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      status = await getBulkOperationStatus();
      if (status?.status === "COMPLETED" || status?.status === "FAILED") break;
    }

    if (status?.status !== "COMPLETED" || !status.url) {
      console.warn(
        `[cron full-sync] bulk ${operationId} no completó en la ventana: ${status?.status ?? "sin estado"} ${status?.errorCode ?? ""}`,
      );
      return NextResponse.json(
        { ok: false, operationId, status: status?.status ?? null, note: "no completó en la ventana del cron" },
        { status: 202 },
      );
    }

    const result = await ingestBulkCatalog(status.url);
    console.log(`[cron full-sync] ingesta completa: ${status.objectCount} objetos`);
    return NextResponse.json({ ok: true, operationId, objectCount: status.objectCount, ...result });
  } catch (err) {
    console.error("[cron full-sync] falló:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
