import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { saveAdminAccessToken } from "@/lib/shopify/token";

/**
 * Callback del authorization code grant. Verifica state + HMAC, intercambia
 * el code por un token offline (shpat_) y lo guarda en la DB.
 */
export async function GET(req: NextRequest) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) {
    return NextResponse.json({ error: "Faltan credenciales Shopify en env" }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const shopParam = params.get("shop");
  const savedState = req.cookies.get("shopify_oauth_state")?.value;

  if (!code || !state || state !== savedState) {
    return NextResponse.json({ error: "state inválido o code ausente" }, { status: 400 });
  }
  if (shopParam !== shop) {
    return NextResponse.json({ error: `shop inesperado: ${shopParam}` }, { status: 400 });
  }
  if (!verifyOauthHmac(params, clientSecret)) {
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return NextResponse.json(
      { error: `intercambio de token falló (${tokenRes.status})`, body: body.slice(0, 500) },
      { status: 502 },
    );
  }

  const { access_token, scope } = (await tokenRes.json()) as {
    access_token: string;
    scope: string;
  };
  await saveAdminAccessToken(access_token, scope);

  return new NextResponse(
    `<html lang="es"><body style="font-family: system-ui; padding: 3rem; max-width: 40rem; margin: auto">
      <h1 style="color:#8CBEA3">✓ Token guardado</h1>
      <p>La app quedó conectada a <b>${shop}</b> con scopes: <code>${scope}</code>.</p>
      <p>El token quedó almacenado en la base de datos (sync_state). Ya puedes correr el sync del catálogo.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** HMAC de OAuth: SHA256 hex sobre el query string sin `hmac`, ordenado. */
function verifyOauthHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  return a.length === b.length && timingSafeEqual(a, b);
}
