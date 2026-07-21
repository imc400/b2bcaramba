"use server";

import { redirect } from "next/navigation";
import { changeOwnPassword, requireAdmin } from "@/lib/auth/admin";
import { validatePassword } from "@/lib/auth/password";

export type ChangePasswordState = { status: "idle" | "error" | "ok"; message?: string };

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireAdmin({ permitirCambioPendiente: true });

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next !== confirm) return { status: "error", message: "Las contraseñas nuevas no coinciden." };
  const invalida = validatePassword(next);
  if (invalida) return { status: "error", message: invalida };

  const result = await changeOwnPassword(user, current, next);
  if (!result.ok) return { status: "error", message: result.error };

  // Si venía de un cambio forzado, ya puede usar el panel.
  if (user.mustChangePassword) redirect("/admin/pedidos");
  return { status: "ok", message: "Contraseña actualizada." };
}
