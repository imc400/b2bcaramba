import Link from "next/link";
import { redirect } from "next/navigation";
import { accentText, BannerDecoration } from "@/components/brand";
import { getMicrositeSession } from "@/lib/auth/session";
import { getCampaignCatalog } from "@/lib/catalog";
import { getRemainingQuota } from "@/lib/orders";
import { SelectionProvider } from "../selection";
import { ProductGrid, SelectionBar } from "./product-grid";

const AGE_PARAM = "edad";
const CAT_PARAM = "cat";
const SEARCH_PARAM = "q";

export default async function TiendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const session = await getMicrositeSession();
  if (!session || session.company.slug !== slug) redirect(`/${slug}`);

  const sp = await searchParams;
  const selectedAges = toArray(sp[AGE_PARAM]);
  const selectedCategories = toArray(sp[CAT_PARAM]);
  const search = typeof sp[SEARCH_PARAM] === "string" ? sp[SEARCH_PARAM] : undefined;

  const [{ items, total, facets }, remaining] = await Promise.all([
    getCampaignCatalog({
      filter: session.campaign.catalogFilter,
      safetyStock: session.campaign.safetyStock,
      selectedAges,
      selectedCategories,
      search,
      limit: 60,
    }),
    getRemainingQuota(session.collaborator.id),
  ]);

  const accent = session.campaign.theme?.accentColor ?? "#8CBEA3";
  const textColor = accentText(accent);
  const firstName = (session.collaborator.name ?? "").split(" ")[0];

  return (
    <SelectionProvider campaignId={session.campaign.id} quota={remaining}>
      <main className="mx-auto max-w-6xl px-4 pb-32 sm:px-6">
        {/* Banner compacto */}
        <section
          className="relative mt-6 overflow-hidden rounded-3xl px-8 py-8"
          style={{
            background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
            color: textColor,
          }}
        >
          <BannerDecoration icon="beach-ball" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
              {session.campaign.name} · beneficio {session.company.name}
            </p>
            <h1 className="mt-2 text-2xl sm:text-3xl">
              {firstName ? `¡Hola ${firstName}! ` : ""}
              {session.campaign.bannerTitle}
            </h1>
          </div>
        </section>

        {/* Búsqueda + filtros */}
        <section className="sticky top-16 z-10 -mx-4 mt-4 border-b border-caramba-grafito/8 bg-white/95 px-4 py-3 shadow-[0_8px_16px_-14px_rgba(40,40,40,0.25)] backdrop-blur sm:-mx-6 sm:px-6">
          <form role="search" className="mb-2.5 max-w-md">
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Busca un juguete o una marca"
              enterKeyHint="search"
              aria-label="Buscar en el catálogo"
              className="w-full rounded-full border border-caramba-grafito/15 bg-white px-4 py-2.5 text-base outline-none transition-colors focus:border-caramba-verde focus:ring-2 focus:ring-caramba-verde/25"
            />
          </form>
          <div className="-mx-4 flex snap-x items-center gap-2 overflow-x-auto whitespace-nowrap px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <FacetChips
              slug={slug}
              param={AGE_PARAM}
              label="Edad"
              options={facets.ages.map((a) => a.tag)}
              selected={selectedAges}
              current={sp}
            />
          </div>
          <div className="-mx-4 mt-2 flex snap-x items-center gap-2 overflow-x-auto whitespace-nowrap px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <FacetChips
              slug={slug}
              param={CAT_PARAM}
              label="Categoría"
              options={facets.categories.map((c) => c.name)}
              selected={selectedCategories}
              current={sp}
            />
          </div>
        </section>

        <p className="mt-4 text-sm text-caramba-grafito/70">
          <b className="text-caramba-grafito">{total}</b> producto{total === 1 ? "" : "s"} para tu
          equipo
          {search ? (
            <>
              {" "}
              · búsqueda: “{search}”{" "}
              <Link
                href={`/${slug}/tienda`}
                className="font-semibold text-caramba-rojo hover:underline"
              >
                Limpiar
              </Link>
            </>
          ) : null}
        </p>

        <ProductGrid items={items} />

        {items.length === 0 ? (
          <div className="mt-16 text-center text-caramba-grafito/50">
            <p className="font-display text-lg">No encontramos productos con esos filtros.</p>
            <Link href={`/${slug}/tienda`} className="mt-2 inline-block text-caramba-rojo font-semibold">
              Limpiar filtros →
            </Link>
          </div>
        ) : null}
      </main>
      <SelectionBar slug={slug} />
    </SelectionProvider>
  );
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Chips de facets como links (estado en la URL, server-rendered). */
function FacetChips({
  slug,
  param,
  label,
  options,
  selected,
  current,
}: {
  slug: string;
  param: string;
  label: string;
  options: string[];
  selected: string[];
  current: Record<string, string | string[] | undefined>;
}) {
  if (options.length === 0) return null;

  function hrefWith(values: string[]): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) {
      if (k === param || v == null) continue;
      for (const item of Array.isArray(v) ? v : [v]) q.append(k, item);
    }
    for (const v of values) q.append(param, v);
    const qs = q.toString();
    return `/${slug}/tienda${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/40">
        {label}
      </span>
      {options.map((opt) => {
        const isActive = selected.includes(opt);
        const next = isActive ? selected.filter((s) => s !== opt) : [...selected, opt];
        return (
          <Link
            key={opt}
            href={hrefWith(next)}
            scroll={false}
            className={`inline-flex shrink-0 snap-start items-center rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramba-grafito/40 ${
              isActive
                ? "bg-caramba-grafito text-white border-caramba-grafito"
                : "bg-white text-caramba-grafito/75 border-caramba-grafito/15 hover:border-caramba-grafito/40"
            }`}
          >
            {opt}
          </Link>
        );
      })}
    </>
  );
}
