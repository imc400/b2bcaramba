/**
 * Seed de desarrollo:
 * 1. Descarga el catálogo público de caramba.cl (products.json) y lo inserta
 *    en el espejo local. En producción esto lo reemplaza el bulk sync de la
 *    Admin API (con stock real); aquí el stock es plausible pero ficticio.
 * 2. Crea empresas demo (Entel, Mercado Libre) con campañas, colaboradores
 *    y destinatarios de notificación.
 *
 * Uso: pnpm seed  (idempotente: borra y recrea datos demo)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DEMO_LOCATION_ID = 1;

type PublicProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[];
  updated_at: string;
  variants: {
    id: number;
    title: string;
    sku: string | null;
    price: string;
    compare_at_price: string | null;
    position: number;
    available: boolean;
    updated_at: string;
  }[];
  images: { src: string; width: number; height: number; alt: string | null }[];
};

async function fetchPublicCatalog(): Promise<PublicProduct[]> {
  const all: PublicProduct[] = [];
  for (let page = 1; page <= 8; page++) {
    const res = await fetch(`https://caramba.cl/products.json?limit=250&page=${page}`);
    if (!res.ok) throw new Error(`products.json page ${page}: HTTP ${res.status}`);
    const { products } = (await res.json()) as { products: PublicProduct[] };
    all.push(...products);
    console.log(`  página ${page}: ${products.length} productos`);
    if (products.length < 250) break;
  }
  return all;
}

/** Stock plausible determinístico por id (0 en ~12% de variantes, 1-30 resto). */
function fakeStock(variantId: number): number {
  const h = variantId % 100;
  if (h < 12) return 0;
  if (h < 25) return 1 + (h % 3); // stock bajo 1-3
  return 4 + (h % 27);
}

async function main() {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { sql } = await import("drizzle-orm");

  console.log("→ Descargando catálogo público de caramba.cl…");
  const catalog = await fetchPublicCatalog();
  console.log(`→ ${catalog.length} productos`);

  console.log("→ Limpiando datos previos…");
  await db.execute(sql`
    TRUNCATE order_items, orders, sessions, otp_codes, collaborators,
      notification_recipients, campaigns, companies,
      inventory_levels, variants, products RESTART IDENTITY CASCADE
  `);

  console.log("→ Insertando espejo de productos…");
  let variantCount = 0;
  for (const p of catalog) {
    const images = p.images.map((i) => ({
      url: i.src,
      altText: i.alt,
      width: i.width,
      height: i.height,
    }));
    await db.insert(schema.products).values({
      shopifyId: p.id,
      handle: p.handle,
      title: p.title,
      descriptionHtml: p.body_html,
      vendor: p.vendor,
      productType: p.product_type || null,
      category: p.product_type || null,
      tags: p.tags,
      status: "ACTIVE",
      featuredImageUrl: images[0]?.url ?? null,
      images,
      shopifyUpdatedAt: new Date(p.updated_at),
    });

    for (const v of p.variants) {
      // products.json no expone inventory_item_id: en dev usamos el variant id
      const inventoryItemId = v.id;
      await db.insert(schema.variants).values({
        shopifyId: v.id,
        productId: p.id,
        inventoryItemId,
        title: v.title,
        sku: v.sku,
        priceClp: Math.round(Number(v.price)),
        compareAtPriceClp: v.compare_at_price ? Math.round(Number(v.compare_at_price)) : null,
        position: v.position,
        imageUrl: null,
        availableForSale: v.available,
        shopifyUpdatedAt: new Date(v.updated_at),
      });
      await db.insert(schema.inventoryLevels).values({
        inventoryItemId,
        locationId: DEMO_LOCATION_ID,
        available: v.available ? fakeStock(v.id) : 0,
        shopifyUpdatedAt: new Date(v.updated_at),
      });
      variantCount++;
    }
  }
  console.log(`→ ${variantCount} variantes con stock`);

  console.log("→ Creando empresas demo…");
  const [entel] = await db
    .insert(schema.companies)
    .values({ slug: "entel", name: "Entel", logoUrl: null })
    .returning();
  const [meli] = await db
    .insert(schema.companies)
    .values({ slug: "mercadolibre", name: "Mercado Libre", logoUrl: null })
    .returning();

  const [campEntel] = await db
    .insert(schema.campaigns)
    .values({
      companyId: entel.id,
      name: "Navidad 2026",
      status: "active",
      bannerTitle: "Elige el regalo de Navidad para tus hijos",
      bannerSubtitle: "Catálogo seleccionado para el equipo de Entel.",
      theme: { accentColor: "#8CBEA3" },
      endsAt: new Date("2026-11-15T23:59:59-03:00"),
      catalogFilter: { priceMinClp: 9990, priceMaxClp: 30000 },
      defaultQuota: 2,
      safetyStock: 1,
    })
    .returning();

  await db.insert(schema.campaigns).values({
    companyId: meli.id,
    name: "Día del Niño 2026",
    status: "active",
    bannerTitle: "Un regalo para cada peque de tu familia",
    bannerSubtitle: "Beneficio Mercado Libre · Día del Niño.",
    theme: { accentColor: "#E1B946" },
    endsAt: new Date("2026-08-05T23:59:59-04:00"),
    catalogFilter: { tags: ["Día del Niño"], priceMaxClp: 25000 },
    defaultQuota: 1,
    safetyStock: 1,
  });

  console.log("→ Colaboradores demo…");
  const demoCollaborators = [
    { email: "juan.perez@entel.cl", rut: "12345678-5", name: "Juan Pérez", quota: 2 },
    { email: "m.soto@entel.cl", rut: "9876543-3", name: "Marcela Soto", quota: 1 },
    { email: "r.fuentes@entel.cl", rut: "11222333-4", name: "Rodrigo Fuentes", quota: 3 },
    { email: "igblancora@gmail.com", rut: "17654321-6", name: "Ignacio Blanco", quota: 2 },
  ];
  for (const c of demoCollaborators) {
    await db.insert(schema.collaborators).values({
      companyId: entel.id,
      campaignId: campEntel.id,
      ...c,
    });
  }

  await db.insert(schema.notificationRecipients).values([
    { companyId: null, email: "pedidos@caramba.cl" },
    { companyId: entel.id, email: "beneficios@entel.cl" },
  ]);

  console.log("✓ Seed completo");
  console.log("  Microsite Entel:        http://localhost:3000/entel");
  console.log("  Microsite Mercado Libre: http://localhost:3000/mercadolibre");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
