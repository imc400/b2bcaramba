"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { notificationRecipients } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { fullSyncRequested, inngest } from "@/inngest/client";

export async function addRecipientAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = z
    .object({
      email: z.string().email(),
      companyId: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse({ email: formData.get("email"), companyId: formData.get("companyId") });
  if (!parsed.success) return;

  await db.insert(notificationRecipients).values({
    email: parsed.data.email.toLowerCase(),
    companyId: parsed.data.companyId || null,
  });
  revalidatePath("/admin/ajustes");
}

export async function toggleRecipientAction(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db.update(notificationRecipients).set({ active }).where(eq(notificationRecipients.id, id));
  revalidatePath("/admin/ajustes");
}

export async function deleteRecipientAction(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id));
  revalidatePath("/admin/ajustes");
}

export async function triggerFullSyncAction(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  try {
    await inngest.send(fullSyncRequested.create());
    return { ok: true, message: "Sync completo encolado. Revisa Productos en unos minutos." };
  } catch {
    return {
      ok: false,
      message: "No se pudo encolar (¿Inngest dev server corriendo? npx inngest-cli dev)",
    };
  }
}
