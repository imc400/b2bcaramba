import { inngest, orderCreated } from "@/inngest/client";
import {
  adjustShopifyForOrder,
  confirmOrderToCollaborator,
  loadOrderBundle,
  notifyOrderRecipients,
} from "@/lib/order-effects";

/**
 * Efectos durables post-pedido (vía Inngest, con retries por paso).
 * La lógica vive en src/lib/order-effects.ts, compartida con el fallback
 * inline que corre cuando INNGEST_EVENT_KEY no está configurada.
 */
export const processOrderCreated = inngest.createFunction(
  { id: "process-order-created", retries: 4, triggers: [orderCreated] },
  async ({ event, step }) => {
    const { orderId } = event.data;

    // Cada paso recarga el bundle: los retornos de step.run se serializan
    // (Date → string) y los pasos se reintentan de forma independiente.
    await step.run("adjust-shopify-inventory", async () =>
      adjustShopifyForOrder(await loadOrderBundle(orderId)),
    );
    await step.run("notify-recipients", async () =>
      notifyOrderRecipients(await loadOrderBundle(orderId)),
    );
    await step.run("confirm-collaborator", async () =>
      confirmOrderToCollaborator(await loadOrderBundle(orderId)),
    );

    return { orderId };
  },
);
