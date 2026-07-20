"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { adminUsers, auditLog } from "@/db/schema";
import {
  createMagicLink,
  requireOwner,
  revokeAllSessions,
  setAdminPassword,
} from "@/lib/auth/admin";
import { validatePassword } from "@/lib/auth/password";
import { adminMagicLinkHtml, sendEmail } from "@/lib/email/send";

export type InviteState = {
  status: "idle" | "ok" | "error";
  message?: string;
  // Cuando se crea con contraseña temporal, la devolvemos UNA vez para que el
  // propietario se la comunique a la persona (no queda visible en ningún lado).
  tempPassword?: string;
  tempEmail?: string;
};

const inviteSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().min(2).max(80),
  role: z.enum(["owner", "editor"]),
  modo: z.enum(["password", "magic"]),
  password: z.string().max(200).optional(),
});

/**
 * Crea (o reactiva) un usuario del panel. Dos vías:
 *  - "password": el propietario fija una contraseña temporal; la persona la
 *    cambia al entrar. NO depende de Resend. Es el camino por defecto.
 *  - "magic": se le envía un enlace por correo para que active su cuenta y
 *    fije su propia contraseña. Necesita Resend configurado.
 */
export async function inviteAdminAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireOwner();

  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    name: formData.get("name"),
    role: formData.get("role"),
    modo: formData.get("modo"),
    password: formData.get("password") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Revisa el correo, el nombre y el rol." };
  }
  const { email, name, role, modo, password } = parsed.data;

  if (modo === "password") {
    const invalida = !password ? "Escribe una contraseña temporal." : validatePassword(password);
    if (invalida) return { status: "error", message: invalida };
  }

  const [existente] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  let userId: string;

  if (existente) {
    if (existente.active) {
      return { status: "error", message: `${email} ya tiene acceso al panel.` };
    }
    await db.update(adminUsers).set({ active: true, name, role }).where(eq(adminUsers.id, existente.id));
    userId = existente.id;
  } else {
    const [creado] = await db.insert(adminUsers).values({ email, name, role }).returning();
    userId = creado.id;
  }

  if (modo === "password") {
    await setAdminPassword(userId, password!, true);
    await db.insert(auditLog).values({
      actorEmail: actor.email,
      action: "admin_create_password",
      entity: "admin_user",
      entityId: userId,
      meta: { email, role },
    });
    revalidatePath("/admin/usuarios");
    return {
      status: "ok",
      message: `Cuenta creada para ${name}. Pásale esta contraseña temporal; la cambiará al entrar.`,
      tempPassword: password,
      tempEmail: email,
    };
  }

  const token = await createMagicLink(userId, "invite");
  await sendEmail({
    to: [email],
    subject: "Te invitaron al panel de Caramba",
    html: adminMagicLinkHtml(`${process.env.NEXT_PUBLIC_APP_URL}/admin/entrar?token=${token}`, true),
  });
  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "admin_invite",
    entity: "admin_user",
    entityId: userId,
    meta: { email, role },
  });
  revalidatePath("/admin/usuarios");
  return { status: "ok", message: `Invitación enviada a ${email}.` };
}

/** Revoca el acceso: desactiva la cuenta y cierra todas sus sesiones abiertas. */
export async function revokeAdminAction(adminUserId: string): Promise<void> {
  const actor = await requireOwner();
  if (actor.id === adminUserId) throw new Error("No puedes revocar tu propio acceso");

  // Nunca dejar el panel sin propietario
  const [otroOwner] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, "owner"), eq(adminUsers.active, true), ne(adminUsers.id, adminUserId)))
    .limit(1);
  if (!otroOwner) throw new Error("Debe quedar al menos un propietario activo");

  await db.update(adminUsers).set({ active: false }).where(eq(adminUsers.id, adminUserId));
  await revokeAllSessions(adminUserId);

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "admin_revoke",
    entity: "admin_user",
    entityId: adminUserId,
  });
  revalidatePath("/admin/usuarios");
}

/** Reenvía la invitación a quien no la ha usado. */
export async function resendInviteAction(adminUserId: string): Promise<void> {
  await requireOwner();
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminUserId));
  if (!user || !user.active) return;

  const token = await createMagicLink(user.id, "invite");
  await sendEmail({
    to: [user.email],
    subject: "Te invitaron al panel de Caramba",
    html: adminMagicLinkHtml(`${process.env.NEXT_PUBLIC_APP_URL}/admin/entrar?token=${token}`, true),
  });
  revalidatePath("/admin/usuarios");
}
