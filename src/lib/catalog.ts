import "server-only";
import { and, asc, eq, gt, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLevels, products, variants, type CatalogFilter } from "@/db/schema";
import { getFulfillmentLocationId } from "./shopify/location";

/** Tag de edad reconocido en Shopify: "2-4 años", "0-12 meses", "12-99 años" */
const AGE_TAG = /^\d+-\d+\s+(años|meses)$/i;

export type CatalogProduct = {
  shopifyId: number;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  featuredImageUrl: string | null;
  images: { url: string; altText: string | null }[];
  descriptionHtml: string | null;
  /** Variante representativa disponible (la de menor posición con stock) */
  variantId: number;
  inventoryItemId: number;
  available: number;
};

export type CatalogFacets = {
  ages: { tag: string; count: number }[];
  categories: { name: string; count: number }[];
};

/**
 * Catálogo visible para una campaña: aplica CatalogFilter + stock de
 * seguridad. El precio NUNCA sale de esta función hacia el microsite.
 */
export async function getCampaignCatalog(opts: {
  filter: CatalogFilter;
  safetyStock: number;
  selectedAges?: string[];
  selectedCategories?: string[];
  search?: string;
  limit?: number;
  offset?: number;
  /** false = omite el cálculo de facets (preview del panel admin) */
  withFacets?: boolean;
}): Promise<{ items: CatalogProduct[]; total: number; facets: CatalogFacets }> {
  const { filter, safetyStock } = opts;

  // Condiciones DURAS: aplican siempre, incluso a productos agregados a mano
  // (un producto curado manualmente jamás esquiva el control de stock)
  const hardConditions: SQL[] = [
    eq(products.status, "ACTIVE"),
    eq(variants.availableForSale, true),
    // Solo la bodega que despacha online: las tiendas físicas no cuentan
    eq(inventoryLevels.locationId, getFulfillmentLocationId()),
    // Stock de seguridad: la última unidad (o umbral) nunca se muestra
    gt(inventoryLevels.available, safetyStock),
  ];

  // Condiciones del FILTRO de campaña (definido por Javiera). Los productos
  // en includeProductIds se SUMAN aunque no matcheen este filtro (union);
  // los de excludeProductIds se restan siempre.
  const filterConditions: SQL[] = [];
  if (filter.priceMinClp != null) filterConditions.push(sql`${variants.priceClp} >= ${filter.priceMinClp}`);
  if (filter.priceMaxClp != null) filterConditions.push(sql`${variants.priceClp} <= ${filter.priceMaxClp}`);
  if (filter.tags?.length) filterConditions.push(sql`${products.tags} && ${filter.tags}`);
  if (filter.excludedTags?.length) filterConditions.push(sql`NOT (${products.tags} && ${filter.excludedTags})`);
  if (filter.productTypes?.length) {
    filterConditions.push(
      sql`lower(${products.productType}) IN ${filter.productTypes.map((t) => t.toLowerCase())}`,
    );
  }
  if (filter.vendors?.length) filterConditions.push(inArray(products.vendor, filter.vendors));

  const conditions: SQL[] = [...hardConditions];
  const filterExpr = filterConditions.length ? and(...filterConditions)! : undefined;
  if (filter.includeProductIds?.length) {
    conditions.push(
      filterExpr
        ? or(filterExpr, inArray(products.shopifyId, filter.includeProductIds))!
        : sql`true`,
    );
  } else if (filterExpr) {
    conditions.push(filterExpr);
  }
  if (filter.excludeProductIds?.length) {
    conditions.push(notInArray(products.shopifyId, filter.excludeProductIds));
  }

  // --- Filtros elegidos por el colaborador en el microsite ---
  const userConditions: SQL[] = [];
  if (opts.selectedAges?.length) userConditions.push(sql`${products.tags} && ${opts.selectedAges}`);
  if (opts.selectedCategories?.length) {
    // Case-insensitive: los chips agrupan variantes de mayúsculas
    userConditions.push(
      sql`lower(${products.productType}) IN ${opts.selectedCategories.map((c) => c.toLowerCase())}`,
    );
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    userConditions.push(or(ilike(products.title, q), ilike(products.vendor, q))!);
  }

  const base = and(...conditions);
  const withUser = and(base, ...userConditions);

  // Una fila por producto: variante representativa = menor posición con stock
  const rows = await db
    .selectDistinctOn([products.shopifyId], {
      shopifyId: products.shopifyId,
      title: products.title,
      handle: products.handle,
      vendor: products.vendor,
      productType: products.productType,
      tags: products.tags,
      featuredImageUrl: products.featuredImageUrl,
      images: products.images,
      descriptionHtml: products.descriptionHtml,
      variantId: variants.shopifyId,
      inventoryItemId: variants.inventoryItemId,
      available: inventoryLevels.available,
    })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(withUser)
    .orderBy(products.shopifyId, asc(variants.position));

  const total = rows.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 48;
  // Orden estable y "curado": título asc tras el distinct
  const items = rows
    .sort((a, b) => a.title.localeCompare(b.title, "es"))
    .slice(offset, offset + limit)
    .map((r) => ({
      ...r,
      images: (r.images as { url: string; altText: string | null }[]).slice(0, 4),
    }));

  if (opts.withFacets === false) {
    return { items, total, facets: { ages: [], categories: [] } };
  }

  // Facets sobre el catálogo base (sin filtros de usuario) para chips estables
  const facetRows = await db
    .selectDistinctOn([products.shopifyId], {
      tags: products.tags,
      productType: products.productType,
    })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(base)
    .orderBy(products.shopifyId);

  const ageCount = new Map<string, number>();
  // Categorías: agrupar case-insensitive (Shopify trae "Arte y Manualidades"
  // y "Arte y manualidades" como tipos distintos) — se muestra la variante
  // más frecuente y el filtro matchea todas.
  const catCount = new Map<string, { display: string; count: number }>();
  for (const r of facetRows) {
    for (const t of r.tags) {
      if (AGE_TAG.test(t)) ageCount.set(t, (ageCount.get(t) ?? 0) + 1);
    }
    if (r.productType) {
      const key = r.productType.toLowerCase();
      const prev = catCount.get(key);
      catCount.set(key, {
        display: prev?.display ?? r.productType,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }

  const facets: CatalogFacets = {
    ages: [...ageCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => ageSortKey(a.tag) - ageSortKey(b.tag)),
    categories: [...catCount.values()]
      .map(({ display, count }) => ({ name: display, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };

  return { items, total, facets };
}

/** Ordena edades: meses primero, luego años por inicio de rango. */
function ageSortKey(tag: string): number {
  const m = tag.match(/^(\d+)-(\d+)\s+(años|meses)/i);
  if (!m) return 9999;
  const start = Number(m[1]);
  return m[3].toLowerCase() === "meses" ? start : 100 + start * 10;
}

/** Cantidad de productos que matchea un filtro (para preview en el panel). */
export async function countCatalogMatches(filter: CatalogFilter, safetyStock: number): Promise<number> {
  const { total } = await getCampaignCatalog({ filter, safetyStock, limit: 0, withFacets: false });
  return total;
}

export type CurationProduct = {
  shopifyId: number;
  title: string;
  vendor: string | null;
  featuredImageUrl: string | null;
  priceClp: number;
  available: number;
};

/** Buscador para curaduría manual en el panel (título o marca, con stock). */
export async function searchProductsForCuration(
  query: string,
  limit = 12,
): Promise<CurationProduct[]> {
  const like = `%${query.trim()}%`;
  const rows = await db
    .selectDistinctOn([products.shopifyId], {
      shopifyId: products.shopifyId,
      title: products.title,
      vendor: products.vendor,
      featuredImageUrl: products.featuredImageUrl,
      priceClp: variants.priceClp,
      available: inventoryLevels.available,
    })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(
      and(
        eq(products.status, "ACTIVE"),
        eq(inventoryLevels.locationId, getFulfillmentLocationId()),
        gt(inventoryLevels.available, 0),
        or(ilike(products.title, like), ilike(products.vendor, like))!,
      ),
    )
    .orderBy(products.shopifyId, asc(variants.position))
    .limit(60);

  return rows.sort((a, b) => a.title.localeCompare(b.title, "es")).slice(0, limit);
}
