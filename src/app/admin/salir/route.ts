import { NextRequest, NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/auth/admin";

/** Cierra la sesión del panel (revoca el token en la base, no solo la cookie). */
export async function GET(req: NextRequest) {
  await destroyAdminSession();
  return NextResponse.redirect(new URL("/admin/login", req.nextUrl.origin));
}
