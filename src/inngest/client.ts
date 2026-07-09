import { eventType, Inngest } from "inngest";
import { z } from "zod";

// Eventos tipados (Inngest v4): cada eventType sirve como trigger de función
// y como constructor de eventos validados al enviar.

export const shopifyWebhookReceived = eventType("shopify/webhook.received", {
  schema: z.object({
    webhookId: z.string(),
    topic: z.string(),
    payload: z.unknown(),
  }),
});

export const fullSyncRequested = eventType("sync/full.requested");

export const orderCreated = eventType("order/created", {
  schema: z.object({ orderId: z.string() }),
});

export const inngest = new Inngest({ id: "caramba-b2b" });
