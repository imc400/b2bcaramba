"use client";

import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import {
  emergencyLoginAction,
  requestMagicLinkAction,
  type LoginState,
} from "./actions";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

export function LoginForm({
  errorPassword,
  rateLimited,
  emergenciaDisponible,
}: {
  errorPassword: boolean;
  rateLimited: boolean;
  emergenciaDisponible: boolean;
}) {
  const [state, request, pending] = useActionState<LoginState, FormData>(requestMagicLinkAction, {
    status: "idle",
  });
  const [modoEmergencia, setModoEmergencia] = useState(errorPassword || rateLimited);

  if (state.status === "sent") {
    return (
      <div className="mt-7 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-caramba-verde-soft">
          <MailCheck className="size-6 text-caramba-verde-texto" strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 font-display text-lg text-caramba-grafito">Revisa tu correo</h2>
        <p className="mt-1.5 text-sm text-caramba-grafito/70">
          Si tu correo tiene acceso al panel, te enviamos un enlace para entrar. Vence en 30
          minutos.
        </p>
      </div>
    );
  }

  if (modoEmergencia && emergenciaDisponible) {
    return (
      <form action={emergencyLoginAction} className="mt-6 space-y-4">
        <Field label="Contraseña de emergencia" htmlFor="password">
          <Input id="password" name="password" type="password" required autoFocus />
        </Field>
        {rateLimited ? (
          <p role="alert" className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto">
            Demasiados intentos. Espera 15 minutos.
          </p>
        ) : errorPassword ? (
          <p role="alert" className="rounded-xl bg-caramba-rojo-soft px-4 py-2.5 text-sm text-caramba-rojo-texto">
            Contraseña incorrecta.
          </p>
        ) : null}
        <Button type="submit" className="w-full">
          Entrar
        </Button>
        <button
          type="button"
          onClick={() => setModoEmergencia(false)}
          className="min-h-11 w-full text-sm font-medium text-caramba-grafito/65 hover:text-caramba-grafito"
        >
          ← Entrar con mi correo
        </button>
      </form>
    );
  }

  return (
    <form action={request} className="mt-6 space-y-4">
      <Field label="Tu correo" htmlFor="email" hint="Te enviamos un enlace para entrar, sin contraseña.">
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="javiera@caramba.cl"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          required
          autoFocus
        />
      </Field>
      {state.status === "rate_limited" ? (
        <p role="alert" className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto">
          Pediste varios enlaces seguidos. Espera unos minutos.
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Spinner />
            Enviando
          </>
        ) : (
          "Enviarme el enlace de acceso"
        )}
      </Button>
      {emergenciaDisponible ? (
        <button
          type="button"
          onClick={() => setModoEmergencia(true)}
          className="min-h-11 w-full text-xs font-medium text-caramba-grafito/50 hover:text-caramba-grafito"
        >
          Usar contraseña de emergencia
        </button>
      ) : null}
    </form>
  );
}
