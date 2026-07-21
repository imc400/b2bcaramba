import { NextRequest, NextResponse } from "next/server";
import { createAdminSession, loginWithPassword } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Login con correo + contraseña.
 *
 * Es un Route Handler (no un Server Action) a propósito: al setear la cookie de
 * sesión y redirigir, el `redirect()` de un Server Action emite un 303 que el
 * router del cliente aborta, y el navegador descarta el `Set-Cookie` de esa
 * respuesta abortada → la sesión no se persistía. `NextResponse.redirect`
 * entrega un redirect HTTP normal que sí carga la cookie (mismo patrón que
 * /admin/entrar).
 */

/** Solo destinos internos del panel; nada de open-redirects ni rutas raras. */
function destinoSeguro(next: string | null): string | null {
  if (!next || !next.startsWith("/admin/") || next.includes("//") || next === "/admin/salir") {
    return null;
  }
  return next;
}

export async function POST(req: NextRequest) {
  const base = req.nextUrl.origin;

  // Los server actions verifican Origin solos; un route handler debe hacerlo.
  const origin = req.headers.get("origin");
  if (origin && origin !== base) {
    return NextResponse.json({ error: "origen no permitido" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(new URL("/admin/login?error=cred", base), 303);
  }
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const password = String(form.get("password") ?? "");
  const next = destinoSeguro(form.get("next") ? String(form.get("next")) : null);

  // Doble tope: por IP (botnets chicas) y por cuenta (brute force distribuido).
  const ip = await getClientIp();
  const porIp = await checkRateLimit(`admin_login:${ip}`, 10, 15 * 60);
  const porCuenta = email
    ? await checkRateLimit(`admin_login_email:${email}`, 10, 15 * 60)
    : { allowed: true };
  if (!porIp.allowed || !porCuenta.allowed) {
    return NextResponse.redirect(new URL("/admin/login?error=rate", base), 303);
  }

  const user = await loginWithPassword(email, password);
  if (!user) return NextResponse.redirect(new URL("/admin/login?error=cred", base), 303);

  await createAdminSession(user.id);
  // El cambio forzado de contraseña temporal manda sobre cualquier destino.
  const destino = user.mustChangePassword ? "/admin/cuenta?forzar=1" : (next ?? "/admin/pedidos");
  return NextResponse.redirect(new URL(destino, base), 303);
}
