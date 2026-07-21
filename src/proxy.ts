import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/cookie-names";

/**
 * Capa de autenticación a nivel edge para el panel (/admin).
 *
 * Sin cookie de sesión, cualquier request al panel (documento, navegación RSC
 * o prefetch) redirige al login ANTES de renderizar nada. La validación real
 * de la sesión (token vigente, no revocado, usuario activo) sigue siendo
 * requireAdmin() en cada página contra la base — esto es la primera puerta,
 * no la única.
 */
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/entrar"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next();

  if (!request.cookies.has(ADMIN_COOKIE)) {
    const login = new URL("/admin/login", request.nextUrl.origin);
    // Deep-link: recordar a dónde iba (solo GETs; un POST no se puede reponer).
    if (request.method === "GET" && pathname !== "/admin" && pathname !== "/admin/pedidos") {
      login.searchParams.set("next", pathname + request.nextUrl.search);
    }
    // 303 SIEMPRE: el default (307) preserva el método y re-POSTearía un form
    // o un Server Action con sesión vencida contra la página de login.
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
