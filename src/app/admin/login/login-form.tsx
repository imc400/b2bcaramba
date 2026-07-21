"use client";

import { MailCheck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { requestMagicLinkAction, type LoginState } from "./actions";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

export function LoginForm({ error, next }: { error?: "cred" | "rate"; next?: string }) {
  const [modo, setModo] = useState<"password" | "magic">("password");
  const [entrando, setEntrando] = useState(false);

  // Si el navegador restaura la página desde bfcache (botón Atrás), el estado
  // "entrando" quedaría pegado con el botón deshabilitado.
  useEffect(() => {
    const reset = () => setEntrando(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const [magicState, magicRequest, magicPending] = useActionState<LoginState, FormData>(
    requestMagicLinkAction,
    { status: "idle" },
  );

  if (magicState.status === "sent") {
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

  if (modo === "magic") {
    return (
      <form action={magicRequest} className="mt-6 space-y-4">
        <Field label="Tu correo" htmlFor="magic-email" hint="Te enviamos un enlace para entrar, sin contraseña.">
          <Input
            id="magic-email"
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
        {magicState.status === "rate_limited" ? (
          <p role="alert" className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto">
            Pediste varios enlaces seguidos. Espera unos minutos.
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={magicPending}>
          {magicPending ? (
            <>
              <Spinner />
              Enviando
            </>
          ) : (
            "Enviarme el enlace de acceso"
          )}
        </Button>
        <button
          type="button"
          onClick={() => setModo("password")}
          className="min-h-11 w-full text-sm font-medium text-caramba-grafito/65 hover:text-caramba-grafito"
        >
          ← Entrar con contraseña
        </button>
      </form>
    );
  }

  // Modo contraseña: form nativo hacia el Route Handler (POST /api/admin/login).
  // No es un Server Action a propósito: setear la cookie + redirect en un action
  // emite un 303 que el router aborta y el navegador descarta el Set-Cookie.
  return (
    <form
      method="POST"
      action="/api/admin/login"
      className="mt-6 space-y-4"
      onSubmit={() => setEntrando(true)}
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Correo" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="javiera@caramba.cl"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </Field>
      <Field label="Contraseña" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error === "cred" ? (
        <p role="alert" className="rounded-xl bg-caramba-rojo-soft px-4 py-2.5 text-sm text-caramba-rojo-texto">
          Correo o contraseña incorrectos.
        </p>
      ) : error === "rate" ? (
        <p role="alert" className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto">
          Demasiados intentos. Espera 15 minutos.
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={entrando}>
        {entrando ? (
          <>
            <Spinner />
            Entrando
          </>
        ) : (
          "Entrar"
        )}
      </Button>
      <button
        type="button"
        onClick={() => setModo("magic")}
        className="min-h-11 w-full text-xs font-medium text-caramba-grafito/50 hover:text-caramba-grafito"
      >
        ¿Olvidaste tu contraseña? Entra con un enlace por correo
      </button>
    </form>
  );
}
