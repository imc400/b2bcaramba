"use client";

import { FileSpreadsheet } from "lucide-react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field } from "@/components/ui";
import { importCollaboratorsAction, type ImportResult } from "./actions";

export function ImportForm({
  campaigns,
  defaultCampaignId,
}: {
  campaigns: { id: string; label: string }[];
  defaultCampaignId?: string;
}) {
  const router = useRouter();
  const [state, submit, submitting] = useActionState<ImportResult, FormData>(
    importCollaboratorsAction,
    { status: "idle" },
  );

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="font-display text-base text-caramba-grafito">Importar colaboradores</h2>
        <p className="mt-1 text-sm text-caramba-grafito/55">
          Excel o CSV con columnas <b>correo</b> y/o <b>rut</b>, <b>nombre</b> y <b>cupo</b>.
        </p>
        {/* Descarga de archivo servida por route handler — no es una página */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/admin/colaboradores/plantilla"
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-caramba-verde hover:underline"
        >
          <FileSpreadsheet className="size-4" strokeWidth={1.8} />
          Descargar plantilla de ejemplo (.xlsx)
        </a>
      </div>
      <form action={submit} className="space-y-4">
        <Field label="Campaña" htmlFor="campaignId">
          <select
            id="campaignId"
            name="campaignId"
            defaultValue={defaultCampaignId}
            onChange={(e) => router.push(`/admin/colaboradores?campana=${e.target.value}`)}
            className="w-full rounded-xl border border-caramba-grafito/15 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-caramba-verde"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Archivo (.xlsx o .csv)" htmlFor="file">
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv"
            required
            className="w-full rounded-xl border border-dashed border-caramba-grafito/25 bg-caramba-crema px-4 py-6 text-sm text-caramba-grafito/60 file:mr-3 file:rounded-full file:border-0 file:bg-caramba-grafito file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Importando…" : "Importar lista"}
        </Button>
      </form>

      {state.status === "ok" ? (
        <div className="rounded-xl bg-caramba-verde-soft px-4 py-3 text-sm text-[#3f7a5c]">
          <p className="font-semibold">✓ {state.message}</p>
          {state.skipped?.length ? (
            <ul className="mt-1.5 list-inside list-disc text-xs opacity-80">
              {state.skipped.map((s) => (
                <li key={s.row}>
                  Fila {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {state.status === "error" ? (
        <p className="rounded-xl bg-caramba-rojo-soft px-4 py-3 text-sm text-[#a34433]">
          {state.message}
        </p>
      ) : null}
    </Card>
  );
}
