import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

/**
 * Cierra la sesión del colaborador y vuelve a la página de acceso.
 *
 * SOLO por POST: un GET que desloguea es prefetcheable por Next (ver
 * src/app/admin/salir/route.ts, donde esto revocaba la sesión al cargar el
 * panel). Un GET jamás debe mutar estado.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await destroySession();
  return NextResponse.redirect(new URL(`/${slug}`, req.nextUrl.origin), 303);
}

/** GET inofensivo: cubre links viejos y prefetches. No desloguea. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return NextResponse.redirect(new URL(`/${slug}`, req.nextUrl.origin));
}
