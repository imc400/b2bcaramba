import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

/** Cierra la sesión del colaborador y vuelve a la página de acceso. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await destroySession();
  return NextResponse.redirect(new URL(`/${slug}`, req.nextUrl.origin));
}
