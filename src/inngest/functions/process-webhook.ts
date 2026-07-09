import { inngest, shopifyWebhookReceived } from "@/inngest/client";
import { applyShopifyWebhook, markWebhookProcessed } from "@/lib/shopify/webhook-processor";

/**
 * Procesa webhooks de Shopify de forma durable (retries por paso).
 * La lógica vive en src/lib/shopify/webhook-processor.ts, compartida con el
 * fallback inline del receptor HTTP.
 */
export const processShopifyWebhook = inngest.createFunction(
  {
    id: "process-shopify-webhook",
    retries: 4,
    triggers: [shopifyWebhookReceived],
  },
  async ({ event, step }) => {
    const { topic, payload, webhookId } = event.data;

    await step.run("apply-webhook", () => applyShopifyWebhook(topic, payload));
    await step.run("mark-processed", () => markWebhookProcessed(webhookId));

    return { topic, webhookId };
  },
);
