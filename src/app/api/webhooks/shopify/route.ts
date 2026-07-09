import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { inngest, shopifyWebhookReceived } from "@/inngest/client";
import { applyShopifyWebhook, markWebhookProcessed } from "@/lib/shopify/webhook-processor";
import { verifyShopifyHmac } from "@/lib/shopify/webhook";

/**
 * Receptor de webhooks de Shopify.
 *
 * Contrato con Shopify: responder 200 en <5s o la entrega cuenta como fallida
 * (8 fallos consecutivos ⇒ Shopify ELIMINA la suscripción). Por eso:
 * 1. Verificamos HMAC sobre el body crudo.
 * 2. Deduplicamos por X-Shopify-Webhook-Id (entrega at-least-once).
 * 3. Con Inngest configurado, encolamos (procesamiento durable). Sin Inngest,
 *    aplicamos inline: un webhook de producto es 1 query GraphQL + upserts,
 *    muy por debajo del presupuesto de 5s.
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

  // Dedup: si ya lo vimos, 200 inmediato sin re-procesar
  const inserted = await db
    .insert(webhookEvents)
    .values({ webhookId, topic })
    .onConflictDoNothing()
    .returning({ webhookId: webhookEvents.webhookId });

  if (inserted.length === 0) return NextResponse.json({ ok: true, deduped: true });

  const payload = JSON.parse(rawBody);
  try {
    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send(shopifyWebhookReceived.create({ webhookId, topic, payload }));
    } else {
      await applyShopifyWebhook(topic, payload);
      await markWebhookProcessed(webhookId);
    }
  } catch (err) {
    // Sin este rollback el evento quedaría marcado como "visto" y el reintento
    // de Shopify sería descartado por el dedup: el cambio se perdería para
    // siempre. Liberamos la marca y devolvemos 500 para que Shopify reintente.
    console.error(`[webhook ${topic}] falló, liberando dedup:`, err);
    await db.delete(webhookEvents).where(eq(webhookEvents.webhookId, webhookId));
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
