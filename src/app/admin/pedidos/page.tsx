import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  CircleDollarSign,
  Clock,
  Download,
  Inbox,
  Search,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { campaigns, collaborators, companies, orders } from "@/db/schema";
import { AdminShell, StatCard } from "@/components/admin-shell";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { StatusSelect } from "./status-select";

const STATUS_LABEL: Record<string, { label: string; tone: "amarillo" | "verde" | "neutro" | "rojo" }> = {
  por_preparar: { label: "Por preparar", tone: "amarillo" },
  preparando: { label: "Preparando", tone: "neutro" },
  despachado: { label: "Despachado", tone: "verde" },
  anulado: { label: "Anulado", tone: "neutro" },
  requiere_revision: { label: "Requiere revisión", tone: "rojo" },
};

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; estado?: string; q?: string }>;
}) {
  await requireAdmin();
  const { empresa, estado, q } = await searchParams;

  const conditions: SQL[] = [];
  if (empresa) conditions.push(eq(companies.slug, empresa));
  if (estado) conditions.push(sql`${orders.status} = ${estado}`);
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    conditions.push(
      sql`(${orders.code} ILIKE ${like} OR ${orders.recipientName} ILIKE ${like} OR ${collaborators.name} ILIKE ${like} OR ${orders.comuna} ILIKE ${like})`,
    );
  }

  const rows = await db
    .select({
      order: orders,
      companyName: companies.name,
      companySlug: companies.slug,
      campaignName: campaigns.name,
      collaboratorName: collaborators.name,
      itemsSummary: sql<string>`(
        SELECT string_agg(oi.product_title, ' · ' ORDER BY oi.id)
        FROM order_items oi WHERE oi.order_id = ${orders.id}
      )`,
      totalClp: sql<number>`(
        SELECT coalesce(sum(oi.price_clp * oi.quantity), 0)::int
        FROM order_items oi WHERE oi.order_id = ${orders.id}
      )`,
    })
    .from(orders)
    .innerJoin(companies, eq(orders.companyId, companies.id))
    .innerJoin(campaigns, eq(orders.campaignId, campaigns.id))
    .innerJoin(collaborators, eq(orders.collaboratorId, collaborators.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(200);

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      porPreparar: sql<number>`count(*) FILTER (WHERE status = 'por_preparar')::int`,
      revision: sql<number>`count(*) FILTER (WHERE status = 'requiere_revision')::int`,
      valorClp: sql<number>`(
        SELECT coalesce(sum(oi.price_clp * oi.quantity), 0)::int
        FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.status != 'anulado'
      )`,
    })
    .from(orders);

  const companiesList = await db
    .select({ slug: companies.slug, name: companies.name })
    .from(companies)
    .orderBy(companies.name);

  return (
    <AdminShell
      active="/admin/pedidos"
      title="Pedidos"
      actions={
        // Descarga de archivo servida por route handler — no es una página
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a
          href="/admin/pedidos/export"
          className="inline-flex items-center gap-2 rounded-full bg-caramba-verde px-4 py-2 text-sm font-semibold text-white hover:bg-[#7bab90]"
        >
          <Download className="size-4" strokeWidth={2} />
          Exportar Excel
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={stats.total} label="pedidos recibidos" icon={Inbox} />
        <StatCard value={stats.porPreparar} label="por preparar" tone="amarillo" icon={Clock} />
        <StatCard
          value={stats.revision}
          label="requieren revisión"
          tone={stats.revision > 0 ? "rojo" : "neutro"}
          icon={TriangleAlert}
        />
        <StatCard
          value={`$${stats.valorClp.toLocaleString("es-CL")}`}
          label="valor total (interno)"
          tone="verde"
          icon={CircleDollarSign}
        />
      </div>

      {/* Búsqueda */}
      <form className="mt-6 max-w-md">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-caramba-grafito/35"
            strokeWidth={2}
          />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por código, nombre o comuna…"
            className="w-full rounded-full border border-caramba-grafito/15 bg-white py-2.5 pl-11 pr-4 text-sm outline-none transition-colors focus:border-caramba-verde focus:ring-2 focus:ring-caramba-verde/25"
          />
          {empresa ? <input type="hidden" name="empresa" value={empresa} /> : null}
          {estado ? <input type="hidden" name="estado" value={estado} /> : null}
        </div>
      </form>

      {/* Filtros */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterLink href="/admin/pedidos" active={!empresa && !estado} label="Todos" />
        {companiesList.map((c) => (
          <FilterLink
            key={c.slug}
            href={`/admin/pedidos?empresa=${c.slug}`}
            active={empresa === c.slug}
            label={c.name}
          />
        ))}
        <span className="mx-2 h-5 w-px bg-caramba-grafito/15" />
        {Object.entries(STATUS_LABEL).map(([key, { label }]) => (
          <FilterLink
            key={key}
            href={`/admin/pedidos?estado=${key}${empresa ? `&empresa=${empresa}` : ""}`}
            active={estado === key}
            label={label}
          />
        ))}
      </div>

      {/* Tabla */}
      <div className="mt-6 max-h-[calc(100dvh-330px)] overflow-auto rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(40,40,40,0.08)]">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/60">
              <th className="px-5 py-3.5">Pedido</th>
              <th className="px-5 py-3.5">Colaborador</th>
              <th className="px-5 py-3.5">Empresa</th>
              <th className="px-5 py-3.5">Productos</th>
              <th className="px-5 py-3.5">Comuna</th>
              <th className="px-5 py-3.5">Fecha</th>
              <th className="px-5 py-3.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order.id} className="border-b border-caramba-grafito/5 last:border-0 hover:bg-caramba-crema/50">
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/pedidos/${r.order.id}`}
                    className="font-mono text-[13px] font-semibold tabular-nums text-caramba-grafito underline-offset-4 hover:text-caramba-rojo hover:underline"
                  >
                    {r.order.code}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <p className="font-medium">{r.order.recipientName}</p>
                  <p className="text-xs text-caramba-grafito/50">{r.order.phone}</p>
                </td>
                <td className="px-5 py-3">
                  <Badge tone="neutro">{r.companyName}</Badge>
                </td>
                <td className="max-w-64 px-5 py-3">
                  <p className="truncate" title={r.itemsSummary ?? ""}>
                    {r.itemsSummary}
                  </p>
                </td>
                <td className="px-5 py-3 text-caramba-grafito/70">{r.order.comuna}</td>
                <td className="px-5 py-3 text-caramba-grafito/70">
                  {r.order.createdAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                </td>
                <td className="px-5 py-3">
                  <StatusSelect orderId={r.order.id} current={r.order.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-caramba-grafito/45">
                  No hay pedidos con estos filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-caramba-grafito bg-caramba-grafito text-white"
          : "border-caramba-grafito/15 bg-white text-caramba-grafito/70 hover:border-caramba-grafito/40"
      }`}
    >
      {label}
    </Link>
  );
}
