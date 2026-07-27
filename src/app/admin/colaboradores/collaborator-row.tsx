"use client";

import { Check, Clock, Pencil, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui";
import { deleteCollaboratorAction, updateCollaboratorAction } from "./actions";

export type ColaboradorVista = {
  id: string;
  email: string | null;
  rut: string | null;
  rutFormateado: string | null;
  name: string | null;
  quota: number;
  usedQuota: number;
  invitadoEl: string | null;
};

/**
 * Fila de colaborador con edición en línea. Sin esto, corregir un correo mal
 * tipeado obligaba a re-importar el Excel y dejaba la fila errónea viva —
 * que además recibía una invitación real.
 */
export function CollaboratorRow({ colaborador }: { colaborador: ColaboradorVista }) {
  const [editando, setEditando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({
    email: colaborador.email ?? "",
    rut: colaborador.rutFormateado ?? "",
    name: colaborador.name ?? "",
    quota: String(colaborador.quota),
  });

  function guardar() {
    setError(null);
    startTransition(async () => {
      const r = await updateCollaboratorAction(colaborador.id, {
        email: form.email,
        rut: form.rut,
        name: form.name,
        quota: Number(form.quota),
      });
      if (r.ok) setEditando(false);
      else setError(r.error ?? "No se pudo guardar.");
    });
  }

  function eliminar() {
    setError(null);
    startTransition(async () => {
      const r = await deleteCollaboratorAction(colaborador.id);
      if (!r.ok) {
        setError(r.error ?? "No se pudo eliminar.");
        setConfirmandoBorrado(false);
      }
    });
  }

  if (editando) {
    return (
      <tr className="border-b border-caramba-grafito/5 bg-caramba-crema/40 last:border-0">
        <td className="px-3 py-3">
          <Input
            aria-label="Correo"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="correo@empresa.cl"
            className="py-2 text-sm"
          />
          <Input
            aria-label="RUT"
            value={form.rut}
            onChange={(e) => setForm({ ...form, rut: e.target.value })}
            placeholder="12.345.678-9"
            className="mt-1.5 py-2 text-sm"
          />
        </td>
        <td className="px-3 py-3">
          <Input
            aria-label="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nombre"
            className="py-2 text-sm"
          />
        </td>
        <td className="px-5 py-3 text-xs text-caramba-grafito/45">—</td>
        <td className="px-3 py-3">
          <Input
            aria-label="Cupo"
            type="number"
            min={0}
            max={50}
            value={form.quota}
            onChange={(e) => setForm({ ...form, quota: e.target.value })}
            className="w-20 py-2 text-sm"
          />
        </td>
        <td className="px-5 py-3 text-xs text-caramba-grafito/45">
          {colaborador.usedQuota}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={guardar}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-caramba-verde px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Check className="size-3.5" strokeWidth={2.5} />
              {pending ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => {
                setEditando(false);
                setError(null);
              }}
              className="text-xs font-medium text-caramba-grafito/50 hover:text-caramba-grafito"
            >
              Cancelar
            </button>
          </div>
          {error ? <p className="mt-1.5 text-[11px] font-medium text-caramba-rojo-texto">{error}</p> : null}
        </td>
      </tr>
    );
  }

  return (
    <tr className="group border-b border-caramba-grafito/5 last:border-0">
      <td className="px-3 py-3.5">
        <p className="font-medium text-caramba-grafito">{colaborador.email ?? "—"}</p>
        {colaborador.rutFormateado ? (
          <p className="text-xs text-caramba-grafito/50">{colaborador.rutFormateado}</p>
        ) : null}
        {error ? <p className="mt-1 text-[11px] font-medium text-caramba-rojo-texto">{error}</p> : null}
      </td>
      <td className="px-5 py-3.5 text-caramba-grafito/80">{colaborador.name ?? "—"}</td>
      <td className="px-3 py-3.5">
        {colaborador.invitadoEl ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-caramba-verde-texto">
            <Check className="size-3.5" strokeWidth={2.5} />
            {colaborador.invitadoEl}
          </span>
        ) : colaborador.email ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-caramba-amarillo-texto">
            <Clock className="size-3.5" strokeWidth={2} />
            Pendiente
          </span>
        ) : (
          <span className="text-xs text-caramba-grafito/40">Sin correo</span>
        )}
      </td>
      <td className="px-3 py-3.5">
        <span className="rounded-full bg-caramba-crema px-2.5 py-1 text-xs font-bold">
          {colaborador.quota}
        </span>
      </td>
      <td className="px-3 py-3.5">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
            colaborador.usedQuota >= colaborador.quota
              ? "bg-caramba-verde-soft text-caramba-verde-texto"
              : "bg-caramba-crema text-caramba-grafito/60"
          }`}
        >
          {colaborador.usedQuota}
        </span>
      </td>
      <td className="px-3 py-3.5">
        <div className="flex items-center justify-end gap-3">
          {confirmandoBorrado ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-caramba-grafito/60">¿Eliminar?</span>
              <button
                onClick={eliminar}
                disabled={pending}
                className="font-semibold text-caramba-rojo hover:underline disabled:opacity-50"
              >
                Sí
              </button>
              <button
                onClick={() => setConfirmandoBorrado(false)}
                className="font-medium text-caramba-grafito/50 hover:text-caramba-grafito"
              >
                No
              </button>
            </span>
          ) : (
            // Siempre visibles: en hover-only Javiera no los descubre, y en
            // tablet no hay hover.
            <span className="flex items-center gap-2">
              <button
                onClick={() => setEditando(true)}
                aria-label={`Editar ${colaborador.name ?? colaborador.email ?? "colaborador"}`}
                className="text-caramba-grafito/40 hover:text-caramba-grafito"
              >
                <Pencil className="size-4" strokeWidth={1.8} />
              </button>
              <button
                onClick={() => setConfirmandoBorrado(true)}
                aria-label={`Eliminar ${colaborador.name ?? colaborador.email ?? "colaborador"}`}
                className="text-caramba-grafito/40 hover:text-caramba-rojo"
              >
                <Trash2 className="size-4" strokeWidth={1.8} />
              </button>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
