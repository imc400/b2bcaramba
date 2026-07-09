import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, collaborators, companies } from "@/db/schema";
import { AdminShell, StatCard } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";
import { formatRut } from "@/lib/auth/rut";
import { ImportForm } from "./import-form";

export default async function ColaboradoresPage({
  searchParams,
}: {
  searchParams: Promise<{ campana?: string }>;
}) {
  await requireAdmin();
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

  const totalQuota = rows.reduce((s, r) => s + r.collaborator.quota, 0);
  const totalUsed = rows.reduce((s, r) => s + r.usedQuota, 0);

  return (
    <AdminShell active="/admin/colaboradores" title="Colaboradores">
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <ImportForm
            campaigns={campaignsList.map((c) => ({
              id: c.id,
              label: `${c.companyName} · ${c.name}`,
            }))}
            defaultCampaignId={activeCampaignId}
          />
          <div className="grid grid-cols-2 gap-4">
            <StatCard value={rows.length} label="colaboradores" />
            <StatCard value={`${totalUsed}/${totalQuota}`} label="regalos usados" tone="verde" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-caramba-grafito/8 text-left text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/45">
                <th className="px-5 py-3.5">Correo / RUT</th>
                <th className="px-5 py-3.5">Nombre</th>
                <th className="px-5 py-3.5">Cupo</th>
                <th className="px-5 py-3.5">Usado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ collaborator: c, usedQuota }) => (
                <tr key={c.id} className="border-b border-caramba-grafito/5 last:border-0">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-caramba-grafito">{c.email ?? "—"}</p>
                    {c.rut ? (
                      <p className="text-xs text-caramba-grafito/50">{formatRut(c.rut)}</p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5 text-caramba-grafito/80">{c.name ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-full bg-caramba-crema px-2.5 py-1 text-xs font-bold">
                      {c.quota}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        usedQuota >= c.quota
                          ? "bg-caramba-verde-soft text-[#3f7a5c]"
                          : "bg-caramba-crema text-caramba-grafito/60"
                      }`}
                    >
                      {usedQuota}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-caramba-grafito/45">
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
