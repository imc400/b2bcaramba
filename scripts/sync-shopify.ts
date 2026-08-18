/**
 * Sync completo del catálogo real desde Shopify vía Bulk Operations.
 * Reemplaza los datos del seed con productos, imágenes y STOCK reales.
 *
 *   pnpm sync            # lanza la bulk operation y sincroniza
 *   pnpm sync --cache    # reusa el último JSONL descargado (/tmp/caramba-bulk.jsonl)
 *
 * Replica el flujo de la función Inngest `full-catalog-sync` pero sin depender
 * del dev server de Inngest, para poder correrlo a mano.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFile, writeFile } from "node:fs/promises";

const API_VERSION = "2026-07";
const CACHE_FILE = "/tmp/caramba-bulk.jsonl";
const CHUNK = 250;

const BULK_QUERY = `
{
  products {
    edges {
      node {
        id
        handle
        title
        descriptionHtml
        vendor
        productType
        category { fullName }
        tags
        status
        updatedAt
        edadColecciones: metafield(namespace: "custom", key: "edad_para_colecciones") { value }
        ageGroup: metafield(namespace: "custom", key: "age-group") { value }
        featuredMedia { ... on MediaImage { image { url altText width height } } }
        media { edges { node { ... on MediaImage { image { url altText width height } } } } }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              compareAtPrice
              position
              availableForSale
              updatedAt
              image { url }
              inventoryItem {
                id
                inventoryLevels {
                  edges {
                    node {
                      location { id }
                      quantities(names: ["available"]) { name quantity }
                      updatedAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

async function graphql<T>(token: string, query: string, variables?: object): Promise<T> {
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GIDs de metaobjetos (custom.age-group) → texto visible, en UNA query.
 * Réplica standalone de resolveMetaobjectDisplayNames (operations.ts): este
 * script no puede importarla porque `pnpm sync` corre tsx sin el tsconfig
 * que stubea server-only. Tolerante a permisos: sin el scope read_metaobjects
 * loguea claro, devuelve un mapa vacío y el sync continúa.
 */
async function resolverNombresEdad(token: string, gids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(gids)].filter((g) => g.startsWith("gid://shopify/Metaobject/"));
  if (ids.length === 0) return map;
  try {
    const data = await graphql<{
      nodes: ({
        id: string;
        displayName: string | null;
        fields: { key: string; value: string | null }[];
      } | null)[];
    }>(
      token,
      `query ($ids: [ID!]!) {
         nodes(ids: $ids) {
           ... on Metaobject { id displayName fields { key value } }
         }
       }`,
      { ids },
    );
    for (const node of data.nodes) {
      if (!node?.id) continue;
      const texto =
        node.displayName?.trim() || node.fields.find((f) => f.value?.trim())?.value?.trim();
      if (texto) map.set(node.id, texto);
    }
  } catch (err) {
    console.warn(
      "   ⚠ No se pudieron resolver los metaobjetos de edad recomendada " +
        "(¿falta el scope read_metaobjects? Reinstalar en /api/auth/shopify/install). " +
        "recommended_age queda null. Detalle: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  return map;
}

async function downloadCatalog(token: string): Promise<string> {
  console.log("→ Lanzando bulk operation…");
  const start = await graphql<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    token,
    `mutation ($q: String!) {
       bulkOperationRunQuery(query: $q) {
         bulkOperation { id status }
         userErrors { field message }
       }
     }`,
    { q: BULK_QUERY },
  );
  if (start.bulkOperationRunQuery.userErrors.length) {
    throw new Error(start.bulkOperationRunQuery.userErrors.map((e) => e.message).join("; "));
  }

  console.log("→ Esperando a que Shopify genere el JSONL…");
  let url: string | null = null;
  for (let i = 1; i <= 90; i++) {
    await sleep(5000);
    const poll = await graphql<{
      currentBulkOperation: {
        status: string;
        url: string | null;
        errorCode: string | null;
        objectCount: string;
      } | null;
    }>(token, `{ currentBulkOperation(type: QUERY) { status url errorCode objectCount } }`);
    const op = poll.currentBulkOperation;
    process.stdout.write(`\r   ${op?.status} · ${op?.objectCount ?? 0} objetos      `);
    if (op?.status === "COMPLETED") {
      url = op.url;
      break;
    }
    if (op?.status === "FAILED") throw new Error(`Bulk falló: ${op.errorCode}`);
  }
  console.log();
  if (!url) throw new Error("Timeout esperando la bulk operation");

  const jsonl = await (await fetch(url)).text();
  await writeFile(CACHE_FILE, jsonl);
  console.log(`   JSONL: ${(jsonl.length / 1e6).toFixed(1)} MB (cache: ${CACHE_FILE})`);
  return jsonl;
}

async function ingest(jsonl: string, locationId: number, token: string) {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { sql } = await import("drizzle-orm");
  const { parseBulkCatalogLines } = await import("../src/lib/shopify/bulk-parse");

  console.log("→ Parseando JSONL…");
  const parsed = parseBulkCatalogLines(jsonl.split("\n"));

  // Dedup defensivo: el JSONL puede repetir nodos entre páginas
  const dedup = <T>(arr: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const parsedProducts = dedup(parsed.products, (p) => String(p.shopifyId));
  const productIds = new Set(parsedProducts.map((p) => p.shopifyId));

  // Edad recomendada: una query con los GIDs distintos de custom.age-group.
  // Sin el scope read_metaobjects el resolutor loguea y devuelve un mapa
  // vacío: recommended_age queda null y el sync continúa.
  const nombresEdad = await resolverNombresEdad(
    token,
    parsedProducts.flatMap((c) => (c.recommendedAgeGid ? [c.recommendedAgeGid] : [])),
  );
  const productsList = parsedProducts.map(({ recommendedAgeGid, ...c }) => ({
    ...c,
    recommendedAge: recommendedAgeGid ? (nombresEdad.get(recommendedAgeGid) ?? null) : null,
  }));
  // Variantes huérfanas (producto no incluido) romperían la FK
  const variantsList = dedup(
    parsed.variants.filter((v) => productIds.has(v.productId)),
    (v) => String(v.shopifyId),
  );
  const levelsList = dedup(parsed.levels, (l) => `${l.inventoryItemId}:${l.locationId}`);
  const levelsHere = levelsList.filter((l) => l.locationId === locationId);

  console.log(
    `   ${productsList.length} productos · ${variantsList.length} variantes · ` +
      `${levelsList.length} niveles (${levelsHere.length} en bodega ${locationId})`,
  );
  const dropped = parsed.variants.length - variantsList.length;
  if (dropped > 0) console.log(`   (${dropped} variantes descartadas: sin producto padre)`);

  console.log("→ Escribiendo el espejo…");
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE inventory_levels, variants, products CASCADE`);
    for (let i = 0; i < productsList.length; i += CHUNK) {
      await tx.insert(schema.products).values(productsList.slice(i, i + CHUNK));
    }
    for (let i = 0; i < variantsList.length; i += CHUNK) {
      await tx.insert(schema.variants).values(variantsList.slice(i, i + CHUNK));
    }
    for (let i = 0; i < levelsList.length; i += CHUNK) {
      await tx.insert(schema.inventoryLevels).values(levelsList.slice(i, i + CHUNK));
    }
  });

  const [stats] = await db
    .select({
      productos: sql<number>`(SELECT count(*)::int FROM products)`,
      activos: sql<number>`(SELECT count(*)::int FROM products WHERE status='ACTIVE')`,
      conStock: sql<number>`(
        SELECT count(DISTINCT v.product_id)::int
        FROM variants v JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
        WHERE il.location_id = ${locationId} AND il.available > 1
      )`,
      unidades: sql<number>`(
        SELECT coalesce(sum(available),0)::int FROM inventory_levels WHERE location_id = ${locationId}
      )`,
    })
    .from(sql`(SELECT 1) AS x`);

  console.log("\n✓ Sync completo");
  console.log(`   productos:           ${stats.productos}`);
  console.log(`   activos:             ${stats.activos}`);
  console.log(`   con stock vendible:  ${stats.conStock}  (available > 1 en bodega online)`);
  console.log(`   unidades en bodega:  ${stats.unidades}`);
}

async function main() {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const row = await db.query.syncState.findFirst({
    where: eq(schema.syncState.key, "shopify_admin_token"),
  });
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || (row?.value as { token?: string })?.token;
  if (!token) throw new Error("Sin token: corre el OAuth en /api/auth/shopify/install");

  const locationId = Number(process.env.SHOPIFY_LOCATION_ID);
  if (!locationId) throw new Error("SHOPIFY_LOCATION_ID no definida");

  let jsonl: string | null = null;
  if (process.argv.includes("--cache")) {
    try {
      jsonl = await readFile(CACHE_FILE, "utf8");
      console.log(`→ Usando JSONL cacheado (${(jsonl.length / 1e6).toFixed(1)} MB)`);
    } catch {
      console.log("→ Sin cache disponible");
    }
  }
  jsonl ??= await downloadCatalog(token);

  await ingest(jsonl, locationId, token);
  process.exit(0);
}

main().catch((e) => {
  // Los errores de postgres.js incluyen TODOS los parámetros del query:
  // recortamos para que el mensaje sea legible.
  const raw = String(e?.cause?.message ?? e?.message ?? e);
  console.error("\n✗", raw.split(/\nparams:|Failed query:/)[0].slice(0, 600));
  for (const k of ["detail", "column", "constraint_name", "table_name"] as const) {
    if (e?.cause?.[k]) console.error(`  ${k}: ${e.cause[k]}`);
  }
  process.exit(1);
});
