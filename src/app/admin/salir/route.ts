import { NextRequest, NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/auth/admin";

/**
 * Cierra la sesión del panel (revoca el token en la base, no solo la cookie).
 *
 * SOLO por POST. Antes era un GET linkeado en el sidebar, y Next.js PREFETCHEA
 * los links en producción: al cargar cualquier página del panel, el navegador
 * pre-cargaba /admin/salir y revocaba la sesión recién creada en <1 segundo
 * (visto en admin_sessions: created 17:52:11.6, revoked 17:52:12.2). Un GET
 * jamás debe mutar estado.
 */
export async function POST(req: NextRequest) {
  await destroyAdminSession();
  return NextResponse.redirect(new URL("/admin/login", req.nextUrl.origin), 303);
}

/** GET inofensivo: cubre bookmarks viejos y prefetches en vuelo. No desloguea. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/admin/pedidos", req.nextUrl.origin));
}
