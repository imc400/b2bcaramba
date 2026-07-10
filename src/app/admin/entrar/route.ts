import { NextRequest, NextResponse } from "next/server";
import { createAdminSession, redeemMagicLink } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Consume el magic link del correo y abre la sesión del panel.
 * Un solo uso: si el token ya se usó o venció, vuelve al login explicándolo.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = req.nextUrl.origin;
  if (!token) return NextResponse.redirect(new URL("/admin/login", base));

  // Un token es de 256 bits: adivinarlo es inviable, pero el tope evita que
  // alguien use este endpoint para sondear la base.
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_entrar:${ip}`, 30, 15 * 60);
  if (!allowed) return NextResponse.redirect(new URL("/admin/login?error=rate", base));

  const user = await redeemMagicLink(token);
  if (!user) return NextResponse.redirect(new URL("/admin/login?expirado=1", base));

  await createAdminSession(user.id);
  return NextResponse.redirect(new URL("/admin/pedidos", base));
}
