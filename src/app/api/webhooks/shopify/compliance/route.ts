import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyHmac } from "@/lib/shopify/webhook";

/**
 * Webhooks de compliance obligatorios de Shopify (customers/redact,
 * customers/data_request, shop/redact).
 *
 * La plataforma NO almacena clientes de la tienda: los colaboradores B2B son
 * datos que aporta la empresa cliente, no Shopify. Respondemos 200 verificando
 * la firma; si algún día se guardaran clientes de Shopify, este handler debe
 * borrarlos o exportarlos.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyShopifyHmac(rawBody, req.headers.get("x-shopify-hmac-sha256"))) {
    return NextResponse.json({ error: "invalid hmac" }, { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic");
  console.log(`[compliance] ${topic}: sin datos de clientes de Shopify que procesar`);
  return NextResponse.json({ ok: true });
}
