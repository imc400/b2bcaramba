"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
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

export function StatusSelect({ orderId, current }: { orderId: string; current: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  return (
    <div>
      <span className="relative inline-flex items-center">
        <select
          value={current}
          disabled={pending}
          aria-label="Cambiar estado del pedido"
          onChange={(e) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateOrderStatusAction(orderId, e.target.value);
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1200);
              } catch {
                setError("Este cambio no está permitido desde el estado actual.");
                setTimeout(() => setError(null), 4000);
              }
            })
          }
          className={`cursor-pointer appearance-none rounded-full border-0 py-1.5 pl-3.5 pr-8 text-xs font-semibold outline-none transition-all ${
            TONES[current] ?? TONES.preparando
          } ${pending ? "opacity-50" : ""} ${justSaved ? "ring-2 ring-caramba-verde/60" : ""}`}
        >
          {Object.entries(OPTIONS).map(([value, label]) => (
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
