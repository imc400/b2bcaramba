import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const SCOPES = "read_products,read_inventory,write_inventory";

/**
 * Inicia el authorization code grant contra la tienda.
 * Visitar http://localhost:3000/api/auth/shopify/install con la app
 * configurada en el Dev Dashboard con redirect URL:
 *   {NEXT_PUBLIC_APP_URL}/api/auth/shopify/callback
 */
export function GET() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!shop || !clientId || !appUrl) {
    return NextResponse.json(
      { error: "Faltan SHOPIFY_STORE_DOMAIN / SHOPIFY_CLIENT_ID / NEXT_PUBLIC_APP_URL" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `${appUrl}/api/auth/shopify/callback`;
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/auth/shopify",
  });
  return res;
}
