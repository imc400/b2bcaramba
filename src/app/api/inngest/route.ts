import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { fullCatalogSync } from "@/inngest/functions/full-sync";
import { processOrderCreated } from "@/inngest/functions/order-created";
import { processShopifyWebhook } from "@/inngest/functions/process-webhook";
import { reconcileCatalog } from "@/inngest/functions/reconcile";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processShopifyWebhook, reconcileCatalog, fullCatalogSync, processOrderCreated],
});
