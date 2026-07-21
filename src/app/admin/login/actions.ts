"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { createMagicLink } from "@/lib/auth/admin";
import { adminMagicLinkHtml, sendEmail } from "@/lib/email/send";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export type LoginState = { status: "idle" | "sent" | "rate_limited" };

// El login con correo + contraseña vive en el Route Handler
// `POST /api/admin/login` (no en un Server Action): setear la cookie + redirect
// en un action emite un 303 que el router aborta y descarta el Set-Cookie.

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
    try {
      await sendEmail({
        to: [user.email],
        subject: "Tu acceso al panel de Caramba",
        html: adminMagicLinkHtml(url, false),
      });
    } catch (err) {
      // No rompemos la respuesta "sent" (anti-enumeración) por un fallo de
      // envío; el admin además tiene el login por contraseña como vía primaria.
      console.error("[admin magic link] envío falló:", err);
    }
  }
  return { status: "sent" };
}

// El acceso de emergencia por ADMIN_PASSWORD se eliminó: era un secreto
// compartido que entraba como "el owner más antiguo" (rompía la trazabilidad)
// y quedó redundante con `pnpm admin:password <correo>` como break-glass.
