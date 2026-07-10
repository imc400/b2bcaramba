"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  createMagicLink,
  loginWithEmergencyPassword,
  verifyAdminPassword,
} from "@/lib/auth/admin";
import { adminMagicLinkHtml, sendEmail } from "@/lib/email/send";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export type LoginState = { status: "idle" | "sent" | "rate_limited" };

/**
 * Pide un magic link. Igual que en el microsite, la respuesta es idéntica
 * exista o no la cuenta: no revelamos quién tiene acceso al panel.
 */
export async function requestMagicLinkAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = z
    .object({ email: z.string().email() })
    .safeParse({ email: String(formData.get("email") ?? "").toLowerCase().trim() });
  if (!parsed.success) return { status: "sent" };

  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_magic:${ip}`, 10, 60 * 60);
  if (!allowed) return { status: "rate_limited" };

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.email, parsed.data.email), eq(adminUsers.active, true)))
    .limit(1);

  if (user) {
    const token = await createMagicLink(user.id, "login");
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/admin/entrar?token=${token}`;
    await sendEmail({
      to: [user.email],
      subject: "Tu acceso al panel de Caramba",
      html: adminMagicLinkHtml(url, false),
    });
  }
  return { status: "sent" };
}

/** Acceso de emergencia con ADMIN_PASSWORD (si la variable está definida). */
export async function emergencyLoginAction(formData: FormData): Promise<void> {
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_login:${ip}`, 8, 15 * 60);
  if (!allowed) redirect("/admin/login?error=rate");

  const password = String(formData.get("password") ?? "");
  if (!verifyAdminPassword(password) || !(await loginWithEmergencyPassword())) {
    redirect("/admin/login?error=1");
  }
  redirect("/admin/pedidos");
}
