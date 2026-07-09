import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { inngest, shopifyWebhookReceived } from "@/inngest/client";
import { verifyShopifyHmac } from "@/lib/shopify/webhook";

/**
 * Receptor de webhooks de Shopify.
 * Contrato con Shopify: responder 200 en <5s o la entrega cuenta como fallida
 * (8 fallos consecutivos ⇒ Shopify ELIMINA la suscripción). Por eso aquí solo:
 * 1. Verificamos HMAC sobre el body crudo.
 * 2. Deduplicamos por X-Shopify-Webhook-Id (entrega at-least-once).
 * 3. Encolamos en Inngest y respondemos.
 * Todo el procesamiento real ocurre en las funciones de Inngest.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "invalid hmac" }, { status: 401 });
  }

  const webhookId = req.headers.get("x-shopify-webhook-id");
  const topic = req.headers.get("x-shopify-topic");
  if (!webhookId || !topic) {
    return NextResponse.json({ error: "missing headers" }, { status: 400 });
  }

  // Dedup: si ya lo vimos, 200 inmediato sin re-encolar
  const inserted = await db
    .insert(webhookEvents)
    .values({ webhookId, topic })
    .onConflictDoNothing()
    .returning({ webhookId: webhookEvents.webhookId });

  if (inserted.length > 0) {
    await inngest.send(
      shopifyWebhookReceived.create({
        webhookId,
        topic,
        payload: JSON.parse(rawBody),
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
