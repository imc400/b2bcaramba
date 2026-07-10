/**
 * Verifica el flujo COMPLETO de un pedido contra la tienda real:
 * crear pedido → descontar stock en Shopify → anular → reponer stock.
 *
 * Usa el código real de producción (createOrder / restockOrder). Crea una
 * empresa+campaña+colaborador temporales y los borra al final. El stock de la
 * tienda queda exactamente como estaba.
 *
 *   pnpm verify:pedido --confirm            # contra la DB de .env.local
 *   DATABASE_URL=... pnpm verify:pedido --confirm   # contra producción
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SLUG = "verificacion-interna";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log("Este script crea un pedido real y ajusta stock en Shopify.");
    console.log("Corre con --confirm para ejecutarlo (revierte todo al final).");
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { sql, eq } = await import("drizzle-orm");
  const schema = await import("../src/db/schema");
  const { getFulfillmentLocationId } = await import("../src/lib/shopify/location");
  const { getInventoryQuantities } = await import("../src/lib/shopify/operations");
  const { createOrder } = await import("../src/lib/orders");
  const { restockOrder } = await import("../src/lib/order-effects");

  const locationId = getFulfillmentLocationId();
  const ajusteActivo = process.env.SHOPIFY_STOCK_ADJUST_ENABLED === "true";
  console.log(`Bodega: ${locationId} · ajuste en Shopify: ${ajusteActivo ? "ACTIVO" : "desactivado"}\n`);

  let fallos = 0;
  const check = (ok: boolean, label: string, detalle = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detalle ? ` — ${detalle}` : ""}`);
    if (!ok) fallos++;
  };

  // Producto con stock holgado
  const [row] = await db.execute<{ variant_id: string; inventory_item_id: string; title: string; price_clp: number }>(sql`
    SELECT v.shopify_id AS variant_id, v.inventory_item_id, p.title, v.price_clp
    FROM products p
    JOIN variants v ON v.product_id = p.shopify_id
    JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
    WHERE il.location_id = ${locationId} AND il.available BETWEEN 20 AND 500
      AND p.status = 'ACTIVE' AND v.available_for_sale
    ORDER BY il.available DESC LIMIT 1`);
  if (!row) throw new Error("Sin productos con stock para la prueba");

  const variantId = Number(row.variant_id);
  const iid = Number(row.inventory_item_id);
  console.log(`Producto: ${row.title} ($${row.price_clp})`);

  const antesShopify = (await getInventoryQuantities([iid], locationId)).get(iid)!;
  const [{ available: antesEspejo }] = await db.execute<{ available: number }>(sql`
    SELECT available FROM inventory_levels WHERE inventory_item_id = ${iid} AND location_id = ${locationId}`);
  console.log(`  stock Shopify: ${antesShopify} · espejo: ${antesEspejo}\n`);

  // --- Datos temporales ---
  await db.delete(schema.companies).where(eq(schema.companies.slug, SLUG));
  const [empresa] = await db.insert(schema.companies).values({ slug: SLUG, name: "Verificación Interna" }).returning();
  const [campana] = await db
    .insert(schema.campaigns)
    .values({
      companyId: empresa.id,
      name: "Prueba E2E",
      status: "active",
      bannerTitle: "Prueba",
      defaultQuota: 1,
      safetyStock: 1,
      catalogFilter: {},
    })
    .returning();
  const [colab] = await db
    .insert(schema.collaborators)
    .values({ companyId: empresa.id, campaignId: campana.id, email: null, name: "Tester", quota: 1 })
    .returning();

  try {
    console.log("1. Crear pedido (código real de producción)");
    const r = await createOrder({
      collaboratorId: colab.id,
      campaignId: campana.id,
      companyId: empresa.id,
      variantIds: [variantId],
      recipientName: "Verificación Interna",
      phone: "+56900000000",
      email: null,
      addressLine: "Oficina Caramba",
      comuna: "Las Condes",
      region: null,
      addressNotes: null,
    });
    check(r.ok, "pedido creado", r.ok ? r.code : `${r.error} ${r.detail ?? ""}`);
    if (!r.ok) throw new Error("no se pudo crear el pedido");

    const despuesShopify = (await getInventoryQuantities([iid], locationId)).get(iid)!;
    const [{ available: despuesEspejo }] = await db.execute<{ available: number }>(sql`
      SELECT available FROM inventory_levels WHERE inventory_item_id = ${iid} AND location_id = ${locationId}`);

    check(despuesEspejo === antesEspejo - 1, "espejo descontado", `${antesEspejo} → ${despuesEspejo}`);
    if (ajusteActivo) {
      check(despuesShopify === antesShopify - 1, "STOCK DESCONTADO EN SHOPIFY", `${antesShopify} → ${despuesShopify}`);
    } else {
      check(despuesShopify === antesShopify, "Shopify intacto (gate desactivado)", `${despuesShopify}`);
    }

    console.log("\n2. Anular pedido → reponer stock");
    await restockOrder(r.orderId);
    await db.update(schema.orders).set({ status: "anulado" }).where(eq(schema.orders.id, r.orderId));

    const finalShopify = (await getInventoryQuantities([iid], locationId)).get(iid)!;
    const [{ available: finalEspejo }] = await db.execute<{ available: number }>(sql`
      SELECT available FROM inventory_levels WHERE inventory_item_id = ${iid} AND location_id = ${locationId}`);
    check(finalEspejo === antesEspejo, "espejo restaurado", `${finalEspejo}`);
    check(finalShopify === antesShopify, "Shopify restaurado", `${finalShopify}`);
  } finally {
    console.log("\n3. Limpiando datos temporales");
    // orders.company_id es onDelete: restrict (un pedido real nunca debe
    // desaparecer porque se borre la empresa): borramos los pedidos primero.
    await db.execute(sql`DELETE FROM order_items WHERE order_id IN (
      SELECT id FROM orders WHERE company_id = ${empresa.id})`);
    await db.execute(sql`DELETE FROM orders WHERE company_id = ${empresa.id}`);
    await db.delete(schema.companies).where(eq(schema.companies.id, empresa.id));
    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM companies WHERE slug = ${SLUG}`);
    check(Number(n) === 0, "empresa temporal eliminada (cascade: campaña, colaborador)");
  }

  console.log(fallos === 0 ? "\n✓ FLUJO DE PEDIDO VERIFICADO\n" : `\n✗ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 500));
  process.exit(1);
});
