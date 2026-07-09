"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import {
  identifyAction,
  verifyOtpAction,
  type IdentifyState,
  type VerifyState,
} from "./actions";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

export function AccessForm({ slug, companyName }: { slug: string; companyName: string }) {
  // Remonta el formulario completo para "usar otro correo" sin recargar la página
  const [formKey, setFormKey] = useState(0);
  return (
    <AccessSteps
      key={formKey}
      slug={slug}
      companyName={companyName}
      onReset={() => setFormKey((k) => k + 1)}
    />
  );
}

function AccessSteps({
  slug,
  companyName,
  onReset,
}: {
  slug: string;
  companyName: string;
  onReset: () => void;
}) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [identifyState, identify, identifying] = useActionState<IdentifyState, FormData>(
    identifyAction,
    { status: "idle" },
  );
  const [verifyState, verify, verifying] = useActionState<VerifyState, FormData>(
    verifyOtpAction,
    { status: "idle" },
  );

  const codeInputRef = useRef<HTMLInputElement>(null);
  const sent = identifyState.status === "sent";

  useEffect(() => {
    if (sent) codeInputRef.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (verifyState.status === "ok") router.push(`/${slug}/tienda`);
  }, [verifyState.status, router, slug]);

  return (
    <Card className="p-8 shadow-lg">
      {!sent ? (
        <form action={identify} className="space-y-5">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <h2 className="font-display text-xl text-caramba-grafito">Ingresa con tus datos</h2>
            <p className="mt-1 text-sm text-caramba-grafito/70">
              Validaremos que seas parte del equipo de {companyName}.
            </p>
          </div>
          <Field label="Correo corporativo o RUT" htmlFor="identifier">
            <Input
              id="identifier"
              name="identifier"
              placeholder="nombre@empresa.cl · 12.345.678-9"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={identifying}>
            {identifying ? (
              <>
                <Spinner />
                Enviando
              </>
            ) : (
              "Recibir código de acceso"
            )}
          </Button>
          <p className="text-center text-xs text-caramba-grafito/65">
            Te enviaremos un código de 6 dígitos a tu correo registrado.
          </p>
        </form>
      ) : (
        <form action={verify} className="space-y-5">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="identifier" value={identifier} />
          <div>
            <h2 className="font-display text-xl text-caramba-grafito">Revisa tu correo</h2>
            <p className="mt-1 text-sm text-caramba-grafito/70">
              Si tus datos están registrados, recibirás un código de 6 dígitos en tu correo
              corporativo.
            </p>
          </div>
          <Field label="Código de 6 dígitos" htmlFor="code">
            <Input
              ref={codeInputRef}
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              required
              className="h-14 text-center font-display text-2xl tracking-[0.5em]"
            />
            <p className="mt-1.5 text-xs text-caramba-grafito/65">
              ¿No te llegó? Revisa tu carpeta de spam o pide un código nuevo.
            </p>
          </Field>
          {verifyState.status === "invalid" ? (
            <p
              role="alert"
              className="rounded-xl bg-caramba-rojo-soft px-4 py-2.5 text-sm text-caramba-rojo-texto"
            >
              Código incorrecto o vencido. Revisa e intenta de nuevo.
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={verifying}>
            {verifying ? (
              <>
                <Spinner />
                Validando
              </>
            ) : (
              "Entrar a elegir mis regalos"
            )}
          </Button>
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 w-full text-center text-sm font-medium text-caramba-grafito/65 hover:text-caramba-grafito"
          >
            Usar otro correo o RUT
          </button>
        </form>
      )}
    </Card>
  );
}
