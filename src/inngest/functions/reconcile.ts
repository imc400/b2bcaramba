import { cron } from "inngest";
import { inngest } from "@/inngest/client";
import { reconcileCatalogCore } from "@/lib/shopify/reconcile";

/**
 * Reconciliación incremental horaria (capa 2 del espejo). La lógica vive en
 * reconcileCatalogCore (compartida con el Vercel Cron); aquí solo la envolvemos
 * con el scheduling y los reintentos de Inngest.
 */
export const reconcileCatalog = inngest.createFunction(
  {
    id: "reconcile-catalog",
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [cron("0 * * * *")], // cada hora
  },
  async ({ step }) => step.run("reconcile", reconcileCatalogCore),
);
