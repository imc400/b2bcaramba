import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Shopify.
 * Debe ejecutarse sobre el body CRUDO (sin parsear).
 */
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) throw new Error("SHOPIFY_WEBHOOK_SECRET no está definida");

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
