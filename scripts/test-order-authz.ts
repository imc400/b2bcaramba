/**
 * Verifica que createOrder rechace variantes fuera del catálogo de la campaña.
 * Escenario: la campaña Entel limita a $9.990–$30.000; un cliente manipulado
 * envía el variantId de un producto de $45.990.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  const [cara] = await db.execute<{ variant_id: string; price: number; title: string }>(sql`
    SELECT v.shopify_id AS variant_id, v.price_clp AS price, p.title
    FROM products p
    JOIN variants v ON v.product_id = p.shopify_id
    JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
    WHERE il.location_id = 35186606180 AND il.available > 3
      AND p.status = 'ACTIVE' AND v.available_for_sale AND v.price_clp > 40000
    LIMIT 1`);

  const [barato] = await db.execute<{ variant_id: string; price: number; title: string }>(sql`
    SELECT v.shopify_id AS variant_id, v.price_clp AS price, p.title
    FROM products p
    JOIN variants v ON v.product_id = p.shopify_id
    JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
    WHERE il.location_id = 35186606180 AND il.available > 3
      AND p.status = 'ACTIVE' AND v.available_for_sale
      AND v.price_clp BETWEEN 9990 AND 30000
    LIMIT 1`);

  const [collab] = await db.execute<{ id: string; campaign_id: string; company_id: string }>(sql`
    SELECT id, campaign_id, company_id FROM collaborators WHERE email = 'r.fuentes@entel.cl'`);

  // Idempotencia: los pedidos de corridas anteriores consumen el cupo (3) del
  // colaborador de prueba; a la tercera corrida el caso "válido" fallaría con
  // cupo_excedido. Se eliminan antes de partir.
  await db.execute(sql`
    DELETE FROM order_items WHERE order_id IN (
      SELECT id FROM orders WHERE collaborator_id = ${collab.id} AND recipient_name = 'Test Authz')`);
  await db.execute(sql`
    DELETE FROM orders WHERE collaborator_id = ${collab.id} AND recipient_name = 'Test Authz'`);

  const { createOrder } = await import("../src/lib/orders");
  const base = {
    collaboratorId: collab.id, campaignId: collab.campaign_id, companyId: collab.company_id,
    recipientName: "Test Authz", phone: "+56911112222", email: null,
    addressLine: "Calle Falsa 123", comuna: "Ñuñoa", region: null, addressNotes: null,
  };

  console.log(`fuera de rango: ${cara.title} ($${cara.price})`);
  const r1 = await createOrder({ ...base, variantIds: [Number(cara.variant_id)] });
  console.log("  →", r1.ok ? "❌ ACEPTADO (fallo de seguridad)" : `✓ rechazado: ${r1.error}`);

  console.log(`duplicado: ${barato.title} ×2 (mismo variantId)`);
  const r2 = await createOrder({ ...base, variantIds: [Number(barato.variant_id), Number(barato.variant_id)] });
  console.log("  →", r2.ok ? "❌ ACEPTADO (oversell)" : `✓ rechazado: ${r2.error}`);

  console.log(`válido: ${barato.title} ($${barato.price})`);
  const r3 = await createOrder({ ...base, variantIds: [Number(barato.variant_id)] });
  console.log("  →", r3.ok ? `✓ aceptado: ${r3.code}` : `❌ rechazado: ${r3.error} ${r3.detail ?? ""}`);

  const okAll = !r1.ok && r1.error === "fuera_de_catalogo" && !r2.ok && r2.error === "seleccion_invalida" && r3.ok;
  console.log(okAll ? "\n✓ Autorización de pedidos correcta" : "\n✗ REVISAR");
  process.exit(okAll ? 0 : 1);
}
main().catch((e) => { console.error(String(e?.cause?.message ?? e?.message ?? e).slice(0, 300)); process.exit(1); });
