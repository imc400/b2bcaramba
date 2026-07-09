import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { campaigns, companies } from "@/db/schema";
import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";

const STATUS_BADGE: Record<string, { label: string; tone: "verde" | "amarillo" | "neutro" }> = {
  active: { label: "Activa", tone: "verde" },
  draft: { label: "Borrador", tone: "amarillo" },
  closed: { label: "Cerrada", tone: "neutro" },
};

export default async function EmpresasPage() {
  await requireAdmin();

  const rows = await db
    .select({
      company: companies,
      campaign: campaigns,
      collaboratorCount: sql<number>`(
        SELECT count(*)::int FROM collaborators c WHERE c.campaign_id = ${campaigns.id}
      )`,
      orderCount: sql<number>`(
        SELECT count(*)::int FROM orders o
        WHERE o.campaign_id = ${campaigns.id} AND o.status != 'anulado'
      )`,
    })
    .from(companies)
    .leftJoin(campaigns, eq(campaigns.companyId, companies.id))
    .orderBy(desc(companies.createdAt));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <AdminShell
      active="/admin/empresas"
      title="Empresas"
      actions={
        <Link
          href="/admin/empresas/nueva"
          className="inline-flex items-center gap-2 rounded-full bg-caramba-rojo px-4 py-2 text-sm font-semibold text-white hover:bg-[#b85543]"
        >
          + Nueva empresa
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ company, campaign, collaboratorCount, orderCount }) => (
          <div
            key={`${company.id}-${campaign?.id ?? "none"}`}
            className="rounded-2xl border border-caramba-grafito/8 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {company.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logoUrl} alt="" className="h-9 w-auto max-w-24 object-contain" />
                ) : (
                  <span className="rounded-lg bg-caramba-grafito px-2.5 py-1 text-sm font-bold lowercase text-white">
                    {company.name}
                  </span>
                )}
                <div>
                  <p className="font-display text-lg text-caramba-grafito">{company.name}</p>
                  {campaign ? (
                    <p className="text-sm text-caramba-grafito/55">{campaign.name}</p>
                  ) : null}
                </div>
              </div>
              {campaign ? (
                <Badge tone={STATUS_BADGE[campaign.status].tone}>
                  {STATUS_BADGE[campaign.status].label}
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-6 text-sm text-caramba-grafito/60">
              <span>
                <b className="text-caramba-grafito">{collaboratorCount}</b> colaboradores
              </span>
              <span>
                <b className="text-caramba-grafito">{orderCount}</b> pedidos
              </span>
              {campaign?.endsAt ? (
                <span>
                  cierra{" "}
                  {campaign.endsAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-caramba-crema px-4 py-2.5">
              <code className="truncate text-[13px] text-caramba-grafito/70">
                {appUrl}/{company.slug}
              </code>
              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/${company.slug}`}
                  target="_blank"
                  className="text-[13px] font-semibold text-caramba-verde hover:underline"
                >
                  Ver ↗
                </Link>
                <Link
                  href={`/admin/empresas/${company.id}`}
                  className="text-[13px] font-semibold text-caramba-rojo hover:underline"
                >
                  Editar
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-12 text-center text-caramba-grafito/45">
          Aún no hay empresas. Crea la primera con “+ Nueva empresa”.
        </p>
      ) : null}
    </AdminShell>
  );
}
