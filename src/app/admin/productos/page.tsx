import { desc, eq, ilike, sql } from "drizzle-orm";
import Image from "next/image";
import { db } from "@/db";
import { products, syncState } from "@/db/schema";
import { AdminShell, StatCard } from "@/components/admin-shell";
import { Badge, Input } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getFulfillmentLocationId } from "@/lib/shopify/location";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;

  const rows = await db
    .select({
      product: products,
      // SOLO la bodega que despacha online. Sumar las 5 locations mostraría
      // stock que la bodega no puede despachar (y que el microsite oculta).
      totalStock: sql<number>`(
        SELECT coalesce(sum(il.available), 0)::int
        FROM variants v JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
        WHERE v.product_id = "products"."shopify_id"
          AND il.location_id = ${getFulfillmentLocationId()}
      )`,
      minPrice: sql<number>`(
        SELECT min(v.price_clp)::int FROM variants v WHERE v.product_id = "products"."shopify_id"
      )`,
    })
    .from(products)
    .where(q ? ilike(products.title, `%${q}%`) : undefined)
    .orderBy(desc(products.syncedAt))
    .limit(50);

  const [stats] = await db.select({
    total: sql<number>`count(*)::int`,
    active: sql<number>`count(*) FILTER (WHERE status = 'ACTIVE')::int`,
    lastSync: sql<string | null>`max(synced_at)::text`,
  }).from(products);

  const tokenRow = await db.query.syncState.findFirst({
    where: eq(syncState.key, "shopify_admin_token"),
  });

  return (
    <AdminShell active="/admin/productos" title="Productos · espejo de Shopify">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={stats.total} label="productos en espejo" />
        <StatCard value={stats.active} label="activos" tone="verde" />
        <StatCard
          value={stats.lastSync ? new Date(stats.lastSync).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
          label="último sync"
        />
        <StatCard
          value={tokenRow || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ? "Conectado" : "Sin token"}
          label="Shopify Admin API"
          tone={tokenRow || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ? "verde" : "amarillo"}
        />
      </div>

      <form className="mt-6 max-w-md">
        <Input name="q" placeholder="Buscar producto…" defaultValue={q} />
      </form>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-caramba-grafito/8 text-left text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/45">
              <th className="px-5 py-3.5">Producto</th>
              <th className="px-5 py-3.5">Categoría</th>
              <th className="px-5 py-3.5">Precio (CLP)</th>
              <th className="px-5 py-3.5">Stock</th>
              <th className="px-5 py-3.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ product: p, totalStock, minPrice }) => (
              <tr key={p.shopifyId} className="border-b border-caramba-grafito/5 last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-caramba-crema">
                      {p.featuredImageUrl ? (
                        <Image
                          src={p.featuredImageUrl}
                          alt=""
                          fill
                          sizes="44px"
                          className="object-contain p-1"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-caramba-grafito">{p.title}</p>
                      <p className="text-xs text-caramba-grafito/50">{p.vendor}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-caramba-grafito/70">{p.productType ?? "—"}</td>
                <td className="px-5 py-3 text-caramba-grafito/70">
                  ${minPrice?.toLocaleString("es-CL") ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      totalStock === 0
                        ? "bg-caramba-rojo-soft text-[#a34433]"
                        : totalStock <= 3
                          ? "bg-caramba-amarillo-soft text-[#8a6d1a]"
                          : "bg-caramba-verde-soft text-[#3f7a5c]"
                    }`}
                  >
                    {totalStock}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <Badge tone={p.status === "ACTIVE" ? "verde" : "neutro"}>{p.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-caramba-grafito/45">
        Solo lectura: el catálogo se administra en Shopify y se refleja aquí automáticamente.
      </p>
    </AdminShell>
  );
}
