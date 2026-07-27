import { eq } from "drizzle-orm";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { companies, notificationRecipients, syncState } from "@/db/schema";
import { AdminShell } from "@/components/admin-shell";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { generarReporteSalud } from "@/lib/health";
import { getAdminAccessToken } from "@/lib/shopify/token";
import {
  addRecipientAction,
  deleteRecipientAction,
  toggleRecipientAction,
} from "./actions";
import { SyncButton } from "./sync-button";

export default async function AjustesPage() {
  const actor = await requireAdmin();

  const recipients = await db
    .select({
      recipient: notificationRecipients,
      companyName: companies.name,
    })
    .from(notificationRecipients)
    .leftJoin(companies, eq(notificationRecipients.companyId, companies.id))
    .orderBy(notificationRecipients.createdAt);

  const companiesList = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .orderBy(companies.name);

  const token = await getAdminAccessToken();
  const reconcileCheckpoint = await db.query.syncState.findFirst({
    where: eq(syncState.key, "reconciliation_checkpoint"),
  });

  const salud = await generarReporteSalud();
  const tonoSalud = { ok: "verde", aviso: "amarillo", critico: "rojo" } as const;

  return (
    <AdminShell active="/admin/ajustes" usuario={actor} title="Ajustes">
      {/* Estado de la plataforma: lo mismo que vigila el cron de alertas */}
      <Card className="mb-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base text-caramba-grafito">Estado de la plataforma</h2>
            <p className="mt-1 text-sm text-caramba-grafito/55">
              Revisión automática cada 6 horas. Si algo falla, te llega un correo.
            </p>
          </div>
          <Badge tone={tonoSalud[salud.severidad]}>
            {salud.severidad === "ok"
              ? "Todo en orden"
              : salud.severidad === "aviso"
                ? "Con avisos"
                : "Requiere atención"}
          </Badge>
        </div>
        <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {salud.chequeos.map((c) => (
            <li
              key={c.id}
              className={`rounded-xl border px-4 py-3 ${
                c.severidad === "critico"
                  ? "border-caramba-rojo/25 bg-caramba-rojo-soft"
                  : c.severidad === "aviso"
                    ? "border-caramba-amarillo/30 bg-caramba-amarillo-soft"
                    : "border-caramba-grafito/8"
              }`}
            >
              <p
                className={`flex items-center gap-2 text-sm font-semibold ${
                  c.severidad === "critico"
                    ? "text-caramba-rojo-texto"
                    : c.severidad === "aviso"
                      ? "text-caramba-amarillo-texto"
                      : "text-caramba-grafito"
                }`}
              >
                {c.severidad === "ok" ? (
                  <CircleCheck className="size-4 shrink-0 text-caramba-verde-texto" strokeWidth={2} />
                ) : (
                  <TriangleAlert className="size-4 shrink-0" strokeWidth={2} />
                )}
                {c.titulo}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-caramba-grafito/65">{c.detalle}</p>
              {c.severidad !== "ok" && c.accion ? (
                <p className="mt-1.5 text-[11px] text-caramba-grafito/50">→ {c.accion}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Notificaciones */}
        <Card className="space-y-5 p-6">
          <div>
            <h2 className="font-display text-base text-caramba-grafito">
              Correos que reciben los pedidos
            </h2>
            <p className="mt-1 text-sm text-caramba-grafito/55">
              Cada pedido nuevo se notifica a estos correos. “Todas” aplica a todas las empresas.
            </p>
          </div>

          <ul className="space-y-2">
            {recipients.map(({ recipient: r, companyName }) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-caramba-grafito/8 px-4 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`truncate text-sm font-medium ${r.active ? "text-caramba-grafito" : "text-caramba-grafito/40 line-through"}`}
                  >
                    {r.email}
                  </span>
                  <Badge tone={companyName ? "neutro" : "verde"}>{companyName ?? "Todas"}</Badge>
                </div>
                <div className="flex shrink-0 gap-3 text-[13px] font-semibold">
                  <form
                    action={async () => {
                      "use server";
                      await toggleRecipientAction(r.id, !r.active);
                    }}
                  >
                    <button className="text-caramba-grafito/50 hover:text-caramba-grafito">
                      {r.active ? "Pausar" : "Activar"}
                    </button>
                  </form>
                  <form
                    action={async () => {
                      "use server";
                      await deleteRecipientAction(r.id);
                    }}
                  >
                    <button className="text-caramba-rojo/70 hover:text-caramba-rojo">Quitar</button>
                  </form>
                </div>
              </li>
            ))}
            {recipients.length === 0 ? (
              <li className="flex items-center gap-2 rounded-xl bg-caramba-amarillo-soft px-4 py-3 text-sm text-[#8a6d1a]">
                <TriangleAlert className="size-4 shrink-0" strokeWidth={2} />
                Sin destinatarios: nadie recibirá los pedidos por correo.
              </li>
            ) : null}
          </ul>

          <form action={addRecipientAction} className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Nuevo correo" htmlFor="email">
                <Input id="email" name="email" type="email" placeholder="bodega@caramba.cl" required />
              </Field>
            </div>
            <div className="w-40">
              <Field label="Empresa" htmlFor="companyId">
                <select
                  id="companyId"
                  name="companyId"
                  className="w-full rounded-xl border border-caramba-grafito/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-caramba-verde"
                >
                  <option value="">Todas</option>
                  {companiesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit" variant="secondary" className="mb-0.5">
              Agregar
            </Button>
          </form>
        </Card>

        {/* Shopify */}
        <Card className="space-y-5 p-6">
          <div>
            <h2 className="font-display text-base text-caramba-grafito">Conexión Shopify</h2>
            <p className="mt-1 text-sm text-caramba-grafito/55">
              Tienda: <code className="text-xs">{process.env.SHOPIFY_STORE_DOMAIN}</code>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Badge tone={token ? "verde" : "amarillo"}>
              {token ? "✓ Token Admin API activo" : "Sin token Admin API"}
            </Badge>
            {reconcileCheckpoint ? (
              <span className="text-xs text-caramba-grafito/50">
                última reconciliación:{" "}
                {new Date(
                  (reconcileCheckpoint.value as { iso: string }).iso,
                ).toLocaleString("es-CL")}
              </span>
            ) : null}
          </div>

          {!token ? (
            <div className="rounded-xl bg-caramba-amarillo-soft px-4 py-3 text-sm text-[#8a6d1a]">
              <p className="font-semibold">Conectar la tienda (una vez):</p>
              <ol className="mt-1.5 list-inside list-decimal space-y-1 text-[13px]">
                <li>
                  En el Dev Dashboard de la app, agrega esta redirect URL:{" "}
                  <code className="text-xs">
                    {process.env.NEXT_PUBLIC_APP_URL}/api/auth/shopify/callback
                  </code>
                </li>
                <li>
                  Visita{" "}
                  {/* Redirect OAuth servido por route handler — no es una página */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/api/auth/shopify/install" className="font-semibold underline">
                    /api/auth/shopify/install
                  </a>{" "}
                  y aprueba la instalación.
                </li>
              </ol>
            </div>
          ) : (
            <SyncButton />
          )}

          <div className="rounded-xl bg-caramba-crema px-4 py-3 text-[13px] leading-relaxed text-caramba-grafito/60">
            El espejo se actualiza solo: webhooks en segundos, reconciliación cada hora y resync
            completo semanal. El stock del catálogo actual es de desarrollo (seed) hasta conectar el
            token.
          </div>
        </Card>
      </div>
    </AdminShell>
  );
}
