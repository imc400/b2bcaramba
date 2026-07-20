"use client";

import { Clock, RefreshCw, Send, UserPlus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { inviteAdminAction, resendInviteAction, revokeAdminAction, type InviteState } from "./actions";

/** Contraseña temporal legible: 3 sílabas + número. */
function generarPassword(): string {
  const silabas = ["ca", "ram", "ba", "lu", "na", "so", "mi", "ta", "re", "pi", "to", "ma"];
  const pick = () => silabas[Math.floor(Math.random() * silabas.length)];
  const num = String(Math.floor(Math.random() * 90) + 10);
  return `${pick()}${pick()}${pick()}${num}`;
}

export function InviteForm({ resendConfigurado }: { resendConfigurado: boolean }) {
  const [state, invite, pending] = useActionState<InviteState, FormData>(inviteAdminAction, {
    status: "idle",
  });
  const [modo, setModo] = useState<"password" | "magic">("password");
  const [password, setPassword] = useState("");

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base text-caramba-grafito">
          <UserPlus className="size-4.5 text-caramba-verde-texto" strokeWidth={1.8} />
          Invitar al panel
        </h2>
        <p className="mt-1 text-sm text-caramba-grafito/70">
          Crea la cuenta con una contraseña temporal que la persona cambia al entrar.
        </p>
      </div>

      {/* Contraseña temporal (mostrada UNA vez tras crear) */}
      {state.status === "ok" && state.tempPassword ? (
        <div className="space-y-2 rounded-xl bg-caramba-verde-soft px-4 py-3">
          <p className="text-sm font-medium text-caramba-verde-texto">{state.message}</p>
          <div className="rounded-lg bg-white px-4 py-3">
            <p className="text-xs text-caramba-grafito/60">{state.tempEmail}</p>
            <p className="mt-0.5 font-mono text-lg font-semibold tracking-wide text-caramba-grafito">
              {state.tempPassword}
            </p>
          </div>
          <p className="text-xs text-caramba-grafito/60">
            Anótala ahora: por seguridad no se vuelve a mostrar.
          </p>
        </div>
      ) : state.status === "ok" ? (
        <p className="rounded-xl bg-caramba-verde-soft px-4 py-3 text-sm font-medium text-caramba-verde-texto">
          {state.message}
        </p>
      ) : null}

      <form action={invite} className="space-y-4">
        <input type="hidden" name="modo" value={modo} />
        <Field label="Nombre" htmlFor="name">
          <Input id="name" name="name" placeholder="Javiera Fernández" required minLength={2} />
        </Field>
        <Field label="Correo" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="javiera@caramba.cl"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </Field>
        <Field label="Rol" htmlFor="role" hint="El propietario además puede invitar y revocar personas.">
          <select
            id="role"
            name="role"
            defaultValue="editor"
            className="w-full rounded-xl border border-caramba-grafito/15 bg-white px-4 py-3 text-base outline-none focus:border-caramba-verde"
          >
            <option value="editor">Editor</option>
            <option value="owner">Propietario</option>
          </select>
        </Field>

        {modo === "password" ? (
          <Field label="Contraseña temporal" htmlFor="password" hint="Mínimo 8 caracteres, con letras y números. La persona la cambiará al entrar.">
            <div className="flex gap-2">
              <Input
                id="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setPassword(generarPassword())}
                title="Generar una contraseña"
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-caramba-grafito/15 px-3 text-sm font-medium text-caramba-grafito/70 hover:border-caramba-grafito/40"
              >
                <RefreshCw className="size-4" strokeWidth={2} />
                Generar
              </button>
            </div>
          </Field>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Creando…"
            : modo === "password"
              ? "Crear cuenta"
              : "Enviar invitación por correo"}
        </Button>
      </form>

      {resendConfigurado ? (
        <button
          type="button"
          onClick={() => setModo((m) => (m === "password" ? "magic" : "password"))}
          className="min-h-11 w-full text-xs font-medium text-caramba-grafito/55 hover:text-caramba-grafito"
        >
          {modo === "password"
            ? "Prefiero enviarle un enlace por correo"
            : "← Prefiero fijar una contraseña temporal"}
        </button>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="rounded-xl bg-caramba-rojo-soft px-4 py-3 text-sm font-medium text-caramba-rojo-texto">
          {state.message}
        </p>
      ) : null}
    </Card>
  );
}

export type UsuarioVista = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "editor";
  active: boolean;
  entroAlgunaVez: boolean;
  ultimoAcceso: string | null;
};

export function UserRow({
  usuario,
  esYo,
  puedeGestionar,
}: {
  usuario: UsuarioVista;
  esYo: boolean;
  puedeGestionar: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);

  return (
    <li className="flex items-center justify-between gap-4 border-b border-caramba-grafito/5 px-6 py-4 last:border-0">
      <div className="min-w-0">
        <p className={`font-medium ${usuario.active ? "text-caramba-grafito" : "text-caramba-grafito/40 line-through"}`}>
          {usuario.name ?? usuario.email}
          {esYo ? <span className="ml-2 text-xs font-normal text-caramba-grafito/50">(tú)</span> : null}
        </p>
        <p className="truncate text-xs text-caramba-grafito/55">{usuario.email}</p>
        {error ? <p className="mt-1 text-[11px] font-medium text-caramba-rojo-texto">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Badge tone={usuario.role === "owner" ? "verde" : "neutro"}>
          {usuario.role === "owner" ? "Propietario" : "Editor"}
        </Badge>

        {!usuario.entroAlgunaVez && usuario.active ? (
          <Badge tone="amarillo">
            <Clock className="size-3" strokeWidth={2.5} />
            Invitación pendiente
          </Badge>
        ) : usuario.ultimoAcceso ? (
          <span className="text-xs text-caramba-grafito/50">Entró {usuario.ultimoAcceso}</span>
        ) : null}

        {puedeGestionar && usuario.active && !usuario.entroAlgunaVez ? (
          <button
            disabled={pending || reenviado}
            onClick={() =>
              startTransition(async () => {
                await resendInviteAction(usuario.id);
                setReenviado(true);
              })
            }
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-caramba-verde-texto hover:underline disabled:opacity-50"
          >
            <Send className="size-3.5" strokeWidth={2} />
            {reenviado ? "Reenviada" : "Reenviar"}
          </button>
        ) : null}

        {puedeGestionar && usuario.active && !esYo ? (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  await revokeAdminAction(usuario.id);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "No se pudo revocar");
                }
              })
            }
            className="text-[13px] font-semibold text-caramba-rojo/70 hover:text-caramba-rojo disabled:opacity-50"
          >
            Revocar
          </button>
        ) : null}
      </div>
    </li>
  );
}
