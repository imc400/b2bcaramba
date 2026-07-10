"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { adminUsers, auditLog } from "@/db/schema";
import { createMagicLink, requireOwner, revokeAllSessions } from "@/lib/auth/admin";
import { adminMagicLinkHtml, sendEmail } from "@/lib/email/send";

export type InviteState = { status: "idle" | "ok" | "error"; message?: string };

const inviteSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().min(2).max(80),
  role: z.enum(["owner", "editor"]),
});

/** Invita a una persona al panel enviándole un magic link de 72 horas. */
export async function inviteAdminAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireOwner();

  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Revisa el correo, el nombre y el rol." };
  }
  const { email, name, role } = parsed.data;

  const [existente] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  let userId: string;

  if (existente) {
    if (existente.active) {
      return { status: "error", message: `${email} ya tiene acceso al panel.` };
    }
    // Reactivar a alguien a quien se le había revocado el acceso
    await db.update(adminUsers).set({ active: true, name, role }).where(eq(adminUsers.id, existente.id));
    userId = existente.id;
  } else {
    const [creado] = await db.insert(adminUsers).values({ email, name, role }).returning();
    userId = creado.id;
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
