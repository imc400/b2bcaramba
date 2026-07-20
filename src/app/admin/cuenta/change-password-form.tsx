"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { changePasswordAction, type ChangePasswordState } from "./actions";

export function ChangePasswordForm({ forzado }: { forzado: boolean }) {
  const [state, submit, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    { status: "idle" },
  );

  return (
    <form action={submit} className="mt-4 space-y-4">
      {/* En el cambio forzado no se pide la contraseña actual (es la temporal
          que el propietario acaba de fijar y el usuario puede no recordar). */}
      {!forzado ? (
        <Field label="Contraseña actual" htmlFor="current">
          <Input id="current" name="current" type="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <Field label="Nueva contraseña" htmlFor="next" hint="Mínimo 8 caracteres, con letras y números.">
        <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Repite la nueva contraseña" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>

      {state.status === "error" ? (
        <p role="alert" className="rounded-xl bg-caramba-rojo-soft px-4 py-2.5 text-sm text-caramba-rojo-texto">
          {state.message}
        </p>
      ) : state.status === "ok" ? (
        <p className="rounded-xl bg-caramba-verde-soft px-4 py-2.5 text-sm text-caramba-verde-texto">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : forzado ? "Guardar y entrar" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
