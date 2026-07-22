/**
 * Contrato de tipos del catálogo: los ids que viajan al cliente DEBEN ser
 * números en runtime, no solo en TypeScript.
 *
 * Existe por un bug real: `variantId` venía de un fragmento sql`` crudo sobre
 * una columna bigint, así que Postgres lo devolvía como string mientras el tipo
 * declaraba number. El carrito serializaba ["4030…"] y TODO pedido moría en la
 * validación con "Revisa los campos del formulario". El typecheck no lo puede
 * atrapar: el tipo miente. Solo un chequeo en runtime lo caza.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getCampaignCatalog, getCampaignProductDetail } = await import("../src/lib/catalog");

  let fallos = 0;
  const check = (ok: boolean, l: string, extra = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${l}${extra ? ` — ${extra}` : ""}`);
    if (!ok) fallos++;
  };

  const filter = { priceMinClp: 9990, priceMaxClp: 20000 };
  const { items } = await getCampaignCatalog({ filter, safetyStock: 1, limit: 3, withFacets: false });

  console.log("1. Tipos del catálogo (los que viajan al carrito)");
  check(items.length > 0, "el catálogo devuelve productos", `${items.length}`);
  for (const it of items) {
    check(typeof it.variantId === "number", `variantId es number (${it.title.slice(0, 28)})`, typeof it.variantId);
    check(Number.isSafeInteger(it.variantId), "variantId es entero seguro (sin pérdida de precisión)");
    check(typeof it.shopifyId === "number", "shopifyId es number", typeof it.shopifyId);
    check(typeof it.inventoryItemId === "number", "inventoryItemId es number", typeof it.inventoryItemId);
    check(typeof it.available === "number", "available es number", typeof it.available);
  }

  console.log("\n2. El id sobrevive el viaje JSON del carrito");
  const idsSerializados = JSON.parse(JSON.stringify(items.map((i) => i.variantId)));
  check(
    idsSerializados.every((v: unknown) => typeof v === "number"),
    "tras JSON.stringify/parse siguen siendo números (no strings entrecomillados)",
  );

  console.log("\n3. Detalle de producto (popup)");
  const detalle = await getCampaignProductDetail({ filter, safetyStock: 1, productId: items[0].shopifyId });
  check(detalle !== null, "devuelve el detalle de un producto del catálogo");
  check(typeof detalle?.shopifyId === "number", "shopifyId es number", typeof detalle?.shopifyId);
  check(Array.isArray(detalle?.images), "trae la galería de imágenes", `${detalle?.images.length} imgs`);
  const ajeno = await getCampaignProductDetail({
    // Precio imposible: ningún producto cae en el filtro → autorización debe negar
    filter: { priceMinClp: 99_000_000, priceMaxClp: 99_000_001 },
    safetyStock: 1,
    productId: items[0].shopifyId,
  });
  check(ajeno === null, "un producto fuera del filtro de la campaña devuelve null");

  console.log(fallos === 0 ? "\n✓ TIPOS DEL CATÁLOGO OK\n" : `\n✗ ${fallos} fallos\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 300));
  process.exit(1);
});
