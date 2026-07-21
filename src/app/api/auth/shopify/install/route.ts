import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin";

const SCOPES = "read_products,read_inventory,write_inventory";

/**
 * Inicia el authorization code grant contra la tienda. Solo para admins con
 * sesión: el callback termina escribiendo el token Admin en la base, así que
 * un GET anónimo no debe poder disparar el flujo.
 * Visitar {NEXT_PUBLIC_APP_URL}/api/auth/shopify/install con la app
 * configurada en el Dev Dashboard con redirect URL:
 *   {NEXT_PUBLIC_APP_URL}/api/auth/shopify/callback
 */
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Solo admins del panel" }, { status: 401 });
  }
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
