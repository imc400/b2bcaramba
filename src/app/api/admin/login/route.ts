import { NextRequest, NextResponse } from "next/server";
import { createAdminSession, loginWithPassword } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Login con correo + contraseña.
 *
 * Es un Route Handler (no un Server Action) a propósito: al setear la cookie de
 * sesión y redirigir, el `redirect()` de un Server Action emite un 303 que el
 * router del cliente aborta, y el navegador descarta el `Set-Cookie` de esa
 * respuesta abortada → la sesión no se persistía y cualquier navegación volvía
 * al login. `NextResponse.redirect` entrega un redirect HTTP normal que sí
 * carga la cookie (mismo patrón que /admin/entrar). Ver también los tests.
 */
export async function POST(req: NextRequest) {
  const base = req.nextUrl.origin;
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_login:${ip}`, 10, 15 * 60);
  if (!allowed) return NextResponse.redirect(new URL("/admin/login?error=rate", base), 303);

  const user = await loginWithPassword(email, password);
  if (!user) return NextResponse.redirect(new URL("/admin/login?error=cred", base), 303);

  await createAdminSession(user.id);
  const destino = user.mustChangePassword ? "/admin/cuenta?forzar=1" : "/admin/pedidos";
  return NextResponse.redirect(new URL(destino, base), 303);
}
