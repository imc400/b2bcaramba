"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VALID_TRANSITIONS } from "@/lib/order-transitions";
import { updateOrderStatusAction } from "./actions";

const OPTIONS: Record<string, string> = {
  por_preparar: "Por preparar",
  preparando: "Preparando",
  despachado: "Despachado",
  anulado: "Anulado",
  requiere_revision: "Requiere revisión",
};

const TONES: Record<string, string> = {
  por_preparar: "bg-caramba-amarillo-soft text-caramba-amarillo-texto",
  preparando: "bg-caramba-crema text-caramba-grafito/70",
  despachado: "bg-caramba-verde-soft text-caramba-verde-texto",
  anulado: "bg-caramba-grafito/8 text-caramba-grafito/50",
  requiere_revision: "bg-caramba-rojo-soft text-caramba-rojo-texto",
};

export function StatusSelect({
  orderId,
  code,
  current,
}: {
  orderId: string;
  code: string;
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Solo se ofrecen los estados alcanzables desde el actual. La acción valida
  // igual en el servidor, por si dos admins mueven el mismo pedido a la vez.
  const reachable = VALID_TRANSITIONS[current] ?? [];

  // Estado terminal (anulado): no hay nada que elegir — pastilla estática.
  if (reachable.length === 0) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold ${
          TONES[current] ?? TONES.preparando
        }`}
      >
        {OPTIONS[current] ?? current}
      </span>
    );
  }

  return (
    <div>
      <span className="relative inline-flex items-center">
        <select
          value={current}
          disabled={pending}
          aria-label="Cambiar estado del pedido"
          onChange={(e) => {
            const next = e.target.value;
            if (next === current) return;
            // Anular es irreversible y repone el stock en Shopify: confirmar.
            if (
              next === "anulado" &&
              !window.confirm(
                `¿Anular el pedido ${code}? Esta acción no se puede deshacer y repone el stock en Shopify.`,
              )
            ) {
              return;
            }
            startTransition(async () => {
              setError(null);
              try {
                await updateOrderStatusAction(orderId, next);
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1200);
              } catch {
                setError("Este cambio no está permitido desde el estado actual.");
                // Probable carrera con otro admin: recargar el estado real.
                router.refresh();
                setTimeout(() => setError(null), 4000);
              }
            });
          }}
          className={`cursor-pointer appearance-none rounded-full border-0 py-1.5 pl-3.5 pr-8 text-xs font-semibold outline-none transition-all ${
            TONES[current] ?? TONES.preparando
          } ${pending ? "opacity-50" : ""} ${justSaved ? "ring-2 ring-caramba-verde/60" : ""}`}
        >
          {Object.entries(OPTIONS)
            .filter(([value]) => value === current || reachable.includes(value))
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        {pending ? (
          <Loader2
            className="pointer-events-none absolute right-2.5 size-3.5 animate-spin opacity-60"
            strokeWidth={2.5}
          />
        ) : (
          <ChevronDown
            className="pointer-events-none absolute right-2.5 size-3.5 opacity-60"
            strokeWidth={2.5}
          />
        )}
      </span>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] font-medium text-caramba-rojo-texto">
          {error}
        </p>
      ) : null}
    </div>
  );
}
