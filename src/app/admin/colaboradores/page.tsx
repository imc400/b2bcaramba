import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
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
  searchParams: Promise<{ campana?: string; pagina?: string; q?: string }>;
}) {
  const actor = await requireAdmin();
  const { campana, pagina: paginaParam, q } = await searchParams;

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

  // Búsqueda y paginación: una campaña de 2.000 personas no cabe en la vista,
  // y antes se truncaba en silencio.
  const POR_PAGINA = 100;
  const pagina = Math.max(1, Number(paginaParam) || 1);
  const busca = (q ?? "").trim();

  const filtro = activeCampaignId
    ? and(
        eq(collaborators.campaignId, activeCampaignId),
        busca
          ? or(
              ilike(collaborators.email, `%${busca}%`),
              ilike(collaborators.name, `%${busca}%`),
              ilike(collaborators.rut, `%${busca.replace(/[.\s]/g, "")}%`),
            )
          : undefined,
      )
    : undefined;

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
        .where(filtro)
        .orderBy(collaborators.name)
        .limit(POR_PAGINA)
        .offset((pagina - 1) * POR_PAGINA)
    : [];

  // Totales en SQL sobre TODA la campaña. Antes se sumaban las filas de la
  // página, así que con >500 colaboradores el "cupo usado" salía mal.
  const [totales] = activeCampaignId
    ? await db
        .select({
          personas: sql<number>`count(*)::int`,
          cupo: sql<number>`coalesce(sum(${collaborators.quota}),0)::int`,
          usado: sql<number>`(
            SELECT coalesce(sum(oi.quantity), 0)::int
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
            WHERE o.campaign_id = ${activeCampaignId} AND o.status != 'anulado'
          )`,
        })
        .from(collaborators)
        .where(eq(collaborators.campaignId, activeCampaignId))
    : [{ personas: 0, cupo: 0, usado: 0 }];

  const [filtrados] = activeCampaignId && busca
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(collaborators)
        .where(filtro)
    : [{ n: totales.personas }];

  const totalListado = filtrados.n;
  const totalPaginas = Math.max(1, Math.ceil(totalListado / POR_PAGINA));

  const [pendientes] = activeCampaignId
    ? await db
        .select({
          total: sql<number>`count(*)::int`,
          sinCorreo: sql<number>`count(*) FILTER (WHERE email IS NULL)::int`,
        })
        .from(collaborators)
        .where(and(eq(collaborators.campaignId, activeCampaignId), isNull(collaborators.invitedAt)))
    : [{ total: 0, sinCorreo: 0 }];


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
            <StatCard value={totales.personas} label="colaboradores" />
            <StatCard value={`${totales.usado}/${totales.cupo}`} label="regalos usados" tone="verde" />
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          {/* Buscador: con 2.000 personas, encontrar a una a mano es inviable */}
          <form method="GET" className="flex gap-2">
            <input type="hidden" name="campana" value={activeCampaignId ?? ""} />
            <input
              type="search"
              name="q"
              defaultValue={busca}
              placeholder="Buscar por nombre, correo o RUT…"
              className="min-w-0 flex-1 rounded-xl border border-caramba-grafito/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-caramba-verde"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl border border-caramba-grafito/15 bg-white px-4 text-sm font-semibold text-caramba-grafito/70 hover:border-caramba-grafito/40"
            >
              Buscar
            </button>
            {busca ? (
              <a
                href={`/admin/colaboradores?campana=${activeCampaignId ?? ""}`}
                className="flex shrink-0 items-center px-2 text-sm font-medium text-caramba-grafito/50 hover:text-caramba-grafito"
              >
                Limpiar
              </a>
            ) : null}
          </form>

        {/* min-w-0: sin esto el hijo del grid crece con su contenido y la
            tabla se corta a la derecha en vez de scrollear. */}
        <div className="min-w-0 overflow-x-auto rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm">
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
                    {busca
                      ? `Nadie coincide con "${busca}" en esta campaña.`
                      : "Sin colaboradores en esta campaña. Importa un Excel para partir."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

          {/* Paginación explícita: antes se truncaba en 500 sin avisar */}
          {totalListado > 0 ? (
            <div className="flex items-center justify-between gap-4 px-1 text-sm text-caramba-grafito/60">
              <span>
                Mostrando <b className="text-caramba-grafito">{rows.length}</b> de{" "}
                <b className="text-caramba-grafito">{totalListado}</b>
                {busca ? " que coinciden" : " colaboradores"}
              </span>
              {totalPaginas > 1 ? (
                <span className="flex items-center gap-2">
                  {pagina > 1 ? (
                    <a
                      href={`/admin/colaboradores?campana=${activeCampaignId}&pagina=${pagina - 1}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}
                      className="rounded-lg border border-caramba-grafito/15 px-3 py-1.5 font-medium hover:border-caramba-grafito/40"
                    >
                      ← Anterior
                    </a>
                  ) : null}
                  <span className="tabular-nums">
                    Página {pagina} de {totalPaginas}
                  </span>
                  {pagina < totalPaginas ? (
                    <a
                      href={`/admin/colaboradores?campana=${activeCampaignId}&pagina=${pagina + 1}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}
                      className="rounded-lg border border-caramba-grafito/15 px-3 py-1.5 font-medium hover:border-caramba-grafito/40"
                    >
                      Siguiente →
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
