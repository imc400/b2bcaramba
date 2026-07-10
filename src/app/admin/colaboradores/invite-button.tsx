"use client";

import { Send, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { sendCollaboratorInvitesAction, type InviteResult } from "./actions";

/**
 * Envío de invitaciones con confirmación explícita: un Excel de prueba no debe
 * disparar correos reales a los colaboradores de una empresa cliente.
 */
export function InviteButton({
  campaignId,
  campaignLabel,
  pendientes,
  pendientesSinCorreo,
}: {
  campaignId: string;
  campaignLabel: string;
  pendientes: number;
  pendientesSinCorreo: number;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<InviteResult | null>(null);
  const [pending, startTransition] = useTransition();

  const conCorreo = pendientes - pendientesSinCorreo;
  // "invitación" pierde la tilde en plural: "invitaciones", no "invitaciónes"
  const invitaciones = (n: number) => (n === 1 ? "invitación" : "invitaciones");
  const colaboradores = (n: number) => (n === 1 ? "colaborador" : "colaboradores");

  if (resultado) {
    return (
      <Card className="space-y-2 p-6">
        <h2 className="font-display text-base text-caramba-grafito">Invitaciones enviadas</h2>
        {resultado.error ? (
          <p className="rounded-xl bg-caramba-rojo-soft px-4 py-3 text-sm font-medium text-caramba-rojo-texto">
            {resultado.error}
          </p>
        ) : (
          <>
            <p className="rounded-xl bg-caramba-verde-soft px-4 py-3 text-sm font-medium text-caramba-verde-texto">
              Se enviaron {resultado.enviadas} {invitaciones(resultado.enviadas)}.
            </p>
            {resultado.sinCorreo > 0 ? (
              <p className="text-xs text-caramba-grafito/65">
                {resultado.sinCorreo} {colaboradores(resultado.sinCorreo)} sin correo{" "}
                {resultado.sinCorreo === 1 ? "no recibió" : "no recibieron"} nada. Agrégalos al
                Excel con su correo, o compárteles el link tú.
              </p>
            ) : null}
          </>
        )}
        <button
          onClick={() => {
            setResultado(null);
            setConfirmando(false);
          }}
          className="min-h-11 text-sm font-semibold text-caramba-grafito/65 hover:text-caramba-grafito"
        >
          ← Volver
        </button>
      </Card>
    );
  }

  if (confirmando) {
    return (
      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-caramba-amarillo-texto" strokeWidth={2} />
          <div>
            <h2 className="font-display text-base text-caramba-grafito">
              Enviar {conCorreo} {invitaciones(conCorreo)}
            </h2>
            <p className="mt-1 text-sm text-caramba-grafito/70">
              Se enviará un correo real a los colaboradores de <b>{campaignLabel}</b> con el link
              para elegir su regalo. Los que ya fueron invitados no reciben nada de nuevo.
            </p>
            {pendientesSinCorreo > 0 ? (
              <p className="mt-2 text-xs text-caramba-amarillo-texto">
                {pendientesSinCorreo} sin correo quedarán fuera del envío.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="success"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setResultado(await sendCollaboratorInvitesAction(campaignId));
              })
            }
          >
            {pending ? "Enviando…" : `Sí, enviar ${conCorreo}`}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base text-caramba-grafito">
          <Send className="size-4.5 text-caramba-verde-texto" strokeWidth={1.8} />
          Invitar colaboradores
        </h2>
        <p className="mt-1 text-sm text-caramba-grafito/70">
          {pendientes === 0
            ? "Todos los colaboradores con correo ya fueron invitados."
            : `${conCorreo} ${colaboradores(conCorreo)} aún ${conCorreo === 1 ? "no recibe" : "no reciben"} el link de su empresa.`}
        </p>
      </div>
      <Button
        variant={conCorreo > 0 ? "primary" : "secondary"}
        disabled={conCorreo === 0}
        onClick={() => setConfirmando(true)}
        className="w-full"
      >
        {conCorreo > 0 ? `Enviar ${conCorreo} ${invitaciones(conCorreo)}` : "Nada pendiente"}
      </Button>
    </Card>
  );
}
