import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, collaborators, companies } from "@/db/schema";
import { AdminShell, StatCard } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";
import { formatRut } from "@/lib/auth/rut";
import { CollaboratorRow } from "./collaborator-row";
import { ImportForm } from "./import-form";
import { InviteButton } from "./invite-button";

export default async function ColaboradoresPage({
  searchParams,
}: {
  searchParams: Promise<{ campana?: string }>;
}) {
  const actor = await requireAdmin();
  const { campana } = await searchParams;

  const campaignsList = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      companyName: companies.name,
    })
    .from(campaigns)
    .innerJoin(companies, eq(campaigns.companyId, companies.id))
    .orderBy(desc(campaigns.createdAt));

  const activeCampaignId = campana ?? campaignsList[0]?.id;
  const campanaActiva = campaignsList.find((c) => c.id === activeCampaignId);

  const rows = activeCampaignId
    ? await db
        .select({
          collaborator: collaborators,
          usedQuota: sql<number>`(
            SELECT coalesce(sum(oi.quantity), 0)::int
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
            WHERE o.collaborator_id = "collaborators"."id" AND o.status != 'anulado'
          )`,
        })
        .from(collaborators)
        .where(eq(collaborators.campaignId, activeCampaignId))
        .orderBy(collaborators.name)
        .limit(500)
    : [];

  const [pendientes] = activeCampaignId
    ? await db
        .select({
          total: sql<number>`count(*)::int`,
          sinCorreo: sql<number>`count(*) FILTER (WHERE email IS NULL)::int`,
        })
        .from(collaborators)
        .where(and(eq(collaborators.campaignId, activeCampaignId), isNull(collaborators.invitedAt)))
    : [{ total: 0, sinCorreo: 0 }];

  const totalQuota = rows.reduce((s, r) => s + r.collaborator.quota, 0);
  const totalUsed = rows.reduce((s, r) => s + r.usedQuota, 0);

  return (
    <AdminShell active="/admin/colaboradores" title="Colaboradores" usuario={actor}>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <ImportForm
            campaigns={campaignsList.map((c) => ({
              id: c.id,
              label: `${c.companyName} · ${c.name}`,
            }))}
            defaultCampaignId={activeCampaignId}
          />
          {activeCampaignId && campanaActiva ? (
            <InviteButton
              campaignId={activeCampaignId}
              campaignLabel={`${campanaActiva.companyName} · ${campanaActiva.name}`}
              pendientes={pendientes.total}
              pendientesSinCorreo={pendientes.sinCorreo}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <StatCard value={rows.length} label="colaboradores" />
            <StatCard value={`${totalUsed}/${totalQuota}`} label="regalos usados" tone="verde" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-caramba-grafito/8 text-left text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/60">
                <th className="px-3 py-3.5">Correo / RUT</th>
                <th className="px-3 py-3.5">Nombre</th>
                <th className="px-3 py-3.5">Invitación</th>
                <th className="px-3 py-3.5">Cupo</th>
                <th className="px-3 py-3.5">Usado</th>
                <th className="px-3 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ collaborator: c, usedQuota }) => (
                <CollaboratorRow
                  key={c.id}
                  colaborador={{
                    id: c.id,
                    email: c.email,
                    rut: c.rut,
                    rutFormateado: c.rut ? formatRut(c.rut) : null,
                    name: c.name,
                    quota: c.quota,
                    usedQuota,
                    invitadoEl: c.invitedAt
                      ? c.invitedAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })
                      : null,
                  }}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-caramba-grafito/45">
                    Sin colaboradores en esta campaña. Importa un Excel para partir.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
