import "server-only";
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { inventoryLevels, products, variants, type CatalogFilter } from "@/db/schema";
import { getFulfillmentLocationId } from "./shopify/location";

/** Tag de edad reconocido en Shopify: "2-4 años", "0-12 meses", "12-99 años" */
const AGE_TAG_SQL = "^[0-9]+-[0-9]+ (años|meses)$";
const AGE_TAG = /^\d+-\d+\s+(años|meses)$/i;

export type CatalogProduct = {
  shopifyId: number;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  featuredImageUrl: string | null;
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
 * Condiciones que TODO producto visible debe cumplir, sin excepción.
 * Ni siquiera un producto agregado a mano por curaduría las esquiva.
 */
function hardConditions(safetyStock: number): SQL[] {
  return [
    eq(products.status, "ACTIVE"),
    eq(variants.availableForSale, true),
    // Solo la bodega que despacha online: las tiendas físicas no cuentan
    eq(inventoryLevels.locationId, getFulfillmentLocationId()),
    // Stock de seguridad: la última unidad (o umbral) nunca se muestra
    gt(inventoryLevels.available, safetyStock),
  ];
}

/**
 * Condiciones del filtro de campaña (definido por Javiera).
 * Los productos en includeProductIds se SUMAN aunque no cumplan el filtro;
 * los de excludeProductIds se restan siempre.
 */
function campaignConditions(filter: CatalogFilter): SQL[] {
  const conditions: SQL[] = [];
  const rules: SQL[] = [];

  if (filter.priceMinClp != null) rules.push(sql`${variants.priceClp} >= ${filter.priceMinClp}`);
  if (filter.priceMaxClp != null) rules.push(sql`${variants.priceClp} <= ${filter.priceMaxClp}`);
  if (filter.tags?.length) rules.push(arrayOverlaps(products.tags, filter.tags));
  if (filter.excludedTags?.length) rules.push(not(arrayOverlaps(products.tags, filter.excludedTags)));
  if (filter.productTypes?.length) {
    rules.push(
      inArray(
        sql`lower(${products.productType})`,
        filter.productTypes.map((t) => t.toLowerCase()),
      ),
    );
  }
  if (filter.vendors?.length) rules.push(inArray(products.vendor, filter.vendors));

  const hasRules = rules.length > 0;
  const included = filter.includeProductIds?.length
    ? inArray(products.shopifyId, filter.includeProductIds)
    : null;

  if (hasRules && included) {
    // filtro OR curaduría manual
    conditions.push(or(and(...rules)!, included)!);
  } else if (hasRules) {
    conditions.push(and(...rules)!);
  } else if (included) {
    // Campaña 100% curada a mano: SOLO los productos elegidos
    conditions.push(included);
  }

  if (filter.excludeProductIds?.length) {
    conditions.push(notInArray(products.shopifyId, filter.excludeProductIds));
  }
  return conditions;
}

/** Condiciones elegidas por el colaborador en el microsite. */
function userConditions(opts: {
  selectedAges?: string[];
  selectedCategories?: string[];
  search?: string;
}): SQL[] {
  const conditions: SQL[] = [];
  if (opts.selectedAges?.length) conditions.push(arrayOverlaps(products.tags, opts.selectedAges));
  if (opts.selectedCategories?.length) {
    conditions.push(
      inArray(
        sql`lower(${products.productType})`,
        opts.selectedCategories.map((c) => c.toLowerCase()),
      ),
    );
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(or(ilike(products.title, q), ilike(products.vendor, q))!);
  }
  return conditions;
}

/**
 * Catálogo visible para una campaña. Pagina en SQL (nunca trae 5.000
 * productos a memoria) y jamás expone el precio hacia el microsite.
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
  const base = and(...hardConditions(opts.safetyStock), ...campaignConditions(opts.filter))!;
  const withUser = and(base, ...userConditions(opts))!;

  const limit = opts.limit ?? 48;
  const offset = opts.offset ?? 0;

  // Una fila por producto: variante representativa = menor posición con stock.
  // El DISTINCT ON exige ordenar por shopify_id, así que el orden alfabético
  // y la paginación se aplican en la consulta externa.
  // OJO: products.shopifyId y variants.shopifyId se llaman igual en SQL.
  // Sin alias explícito la subquery expone "shopify_id" dos veces y Postgres
  // resuelve la columna equivocada al leerla desde afuera.
  const inner = db
    .selectDistinctOn([products.shopifyId], {
      shopifyId: products.shopifyId,
      title: products.title,
      handle: products.handle,
      vendor: products.vendor,
      productType: products.productType,
      tags: products.tags,
      featuredImageUrl: products.featuredImageUrl,
      // .mapWith(Number) NO es opcional: en un fragmento sql`` crudo, Drizzle no
      // aplica el codec de la columna, y un bigint (int8) llega como STRING
      // desde Postgres. El tipo decía number y en runtime era string, así que
      // el JSON.stringify del carrito mandaba ["4030…"] y el pedido moría en
      // la validación (z.number). Ver scripts/test-catalog-types.ts.
      variantId: sql<number>`${variants.shopifyId}`.mapWith(Number).as("variant_id"),
      inventoryItemId: variants.inventoryItemId,
      available: inventoryLevels.available,
    })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(withUser)
    .orderBy(products.shopifyId, asc(variants.position))
    .as("catalogo");

  const [items, [countRow]] = await Promise.all([
    limit > 0
      ? db.select().from(inner).orderBy(asc(inner.title)).limit(limit).offset(offset)
      : Promise.resolve([]),
    db
      .select({ total: sql<number>`count(DISTINCT ${products.shopifyId})::int` })
      .from(products)
      .innerJoin(variants, eq(variants.productId, products.shopifyId))
      .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
      .where(withUser),
  ]);

  const total = countRow?.total ?? 0;
  if (opts.withFacets === false) {
    return { items, total, facets: { ages: [], categories: [] } };
  }
  return { items, total, facets: await getFacets(base) };
}

export type CatalogProductDetail = {
  shopifyId: number;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  /** Galería completa espejada de Shopify, en su orden */
  images: { url: string; altText: string | null }[];
  /** HTML de Shopify SIN sanitizar: el caller lo pasa por sanitizeProductHtml */
  descriptionHtml: string | null;
};

/**
 * Detalle de UN producto, con la misma autorización que el catálogo: si el
 * producto no pertenece al filtro de la campaña (o no tiene stock visible),
 * devuelve null — un productId manipulado no revela nada. Nunca expone precio.
 */
export async function getCampaignProductDetail(opts: {
  filter: CatalogFilter;
  safetyStock: number;
  productId: number;
}): Promise<CatalogProductDetail | null> {
  const [row] = await db
    .selectDistinctOn([products.shopifyId], {
      shopifyId: products.shopifyId,
      title: products.title,
      vendor: products.vendor,
      productType: products.productType,
      tags: products.tags,
      images: products.images,
      descriptionHtml: products.descriptionHtml,
    })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(
      and(
        eq(products.shopifyId, opts.productId),
        ...hardConditions(opts.safetyStock),
        ...campaignConditions(opts.filter),
      )!,
    )
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    images: (row.images ?? []).map((i) => ({ url: i.url, altText: i.altText })),
  };
}

/**
 * Facets calculadas en SQL sobre el catálogo base (sin los filtros que el
 * colaborador ya eligió), para que los chips no desaparezcan al usarlos.
 */
async function getFacets(base: SQL): Promise<CatalogFacets> {
  const visibles = db
    .selectDistinct({ shopifyId: products.shopifyId })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(base)
    .as("visibles");

  const [ageRows, catRows] = await Promise.all([
    db
      .select({
        tag: sql<string>`tag`,
        count: sql<number>`count(*)::int`,
      })
      .from(
        db
          .select({
            shopifyId: products.shopifyId,
            tag: sql<string>`unnest(${products.tags})`.as("tag"),
          })
          .from(products)
          .innerJoin(visibles, eq(visibles.shopifyId, products.shopifyId))
          .as("tags_expandidos"),
      )
      .where(sql`tag ~ ${AGE_TAG_SQL}`)
      .groupBy(sql`tag`),
    db
      .select({
        // Shopify trae "Arte y Manualidades" y "Arte y manualidades" como
        // tipos distintos: agrupamos case-insensitive y mostramos una variante.
        name: sql<string>`min(${products.productType})`,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .innerJoin(visibles, eq(visibles.shopifyId, products.shopifyId))
      .where(sql`${products.productType} IS NOT NULL AND ${products.productType} <> ''`)
      .groupBy(sql`lower(${products.productType})`)
      .orderBy(sql`count(*) DESC`)
      .limit(12),
  ]);

  return {
    ages: ageRows.sort((a, b) => ageSortKey(a.tag) - ageSortKey(b.tag)),
    categories: catRows,
  };
}

/** Ordena edades: meses primero, luego años por inicio de rango. */
function ageSortKey(tag: string): number {
  const m = tag.match(/^(\d+)-(\d+)\s+(años|meses)/i);
  if (!m) return 9999;
  const start = Number(m[1]);
  return m[3].toLowerCase() === "meses" ? start : 100 + start * 10;
}

/** Cantidad de productos que matchea un filtro (para preview en el panel). */
export async function countCatalogMatches(
  filter: CatalogFilter,
  safetyStock: number,
): Promise<number> {
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
  const inner = db
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
    .as("curacion_resultados");

  return db.select().from(inner).orderBy(asc(inner.title)).limit(limit);
}

/**
 * Variantes que un colaborador PUEDE pedir en su campaña.
 * Es la autoridad de autorización de `createOrder`: sin esto, un cliente
 * malicioso podría pedir cualquier variante de la tienda (fuera del rango de
 * precio, sin stock de seguridad, o de un producto archivado).
 */
export async function getOrderableVariantIds(
  variantIds: number[],
  filter: CatalogFilter,
  safetyStock: number,
): Promise<Set<number>> {
  if (variantIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ variantId: variants.shopifyId })
    .from(products)
    .innerJoin(variants, eq(variants.productId, products.shopifyId))
    .innerJoin(inventoryLevels, eq(inventoryLevels.inventoryItemId, variants.inventoryItemId))
    .where(
      and(
        inArray(variants.shopifyId, variantIds),
        ...hardConditions(safetyStock),
        ...campaignConditions(filter),
      ),
    );
  return new Set(rows.map((r) => r.variantId));
}

export { AGE_TAG };
