import { cron } from "inngest";
import { fullSyncRequested, inngest } from "@/inngest/client";
import { ingestBulkCatalog } from "@/lib/shopify/bulk-ingest";
import { getBulkOperationStatus, startBulkCatalogSync } from "@/lib/shopify/operations";

/**
 * Full-resync del catálogo vía Bulk Operations.
 * - Manual: enviando el evento "sync/full.requested" (botón en el panel).
 * - Programado: cron semanal (domingo 05:00 UTC ≈ 01:00 Chile).
 *
 * La ingesta del JSONL (descarga desde `url` y upsert masivo) se implementa
 * en la fase de sync — este esqueleto deja el ciclo start → poll listo.
 */
export const fullCatalogSync = inngest.createFunction(
  {
    id: "full-catalog-sync",
    retries: 2,
    concurrency: [{ limit: 1 }],
    triggers: [fullSyncRequested, cron("0 5 * * 0")],
  },
  async ({ step }) => {
    const operationId = await step.run("start-bulk-operation", startBulkCatalogSync);

    // Poll hasta que la operación termine (los bulk pueden tardar minutos)
    let status: Awaited<ReturnType<typeof getBulkOperationStatus>> = null;
    for (let i = 1; i <= 60; i++) {
      await step.sleep(`wait-${i}`, "30s");
      status = await step.run(`poll-${i}`, getBulkOperationStatus);
      if (status?.status === "COMPLETED" || status?.status === "FAILED") break;
    }

    if (status?.status !== "COMPLETED" || !status.url) {
      throw new Error(
        `Bulk operation ${operationId} no completó: ${status?.status} ${status?.errorCode ?? ""}`,
      );
    }

    const url = status.url;
    const result = await step.run("ingest-jsonl", () => ingestBulkCatalog(url));
    return { operationId, objectCount: status.objectCount, ...result };
  },
);
