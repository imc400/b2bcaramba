/**
 * Verificación end-to-end del espejo con Shopify, usando el código REAL de
 * producción (src/lib/shopify/*), no una copia.
 *
 *   pnpm verify:shopify          # contra la DB de .env.local
 *   DATABASE_URL=... pnpm verify:shopify   # contra producción
 *
 * Comprueba:
 *  1. La bodega configurada existe y es la que despacha online.
 *  2. Las suscripciones de webhook apuntan a la app desplegada.
 *  3. adjustInventory funciona (compare-and-swap + @idempotent) y es idempotente.
 *  4. El webhook de inventario llega y actualiza el espejo.
 *  5. El stock queda EXACTAMENTE como estaba (delta neto cero).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { getFulfillmentLocationId } = await import("../src/lib/shopify/location");
  const { adjustInventory, getInventoryQuantities } = await import("../src/lib/shopify/operations");
  const { shopifyAdmin } = await import("../src/lib/shopify/client");

  const locationId = getFulfillmentLocationId();
  let fallos = 0;
  const check = (ok: boolean, label: string, detalle = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detalle ? ` — ${detalle}` : ""}`);
    if (!ok) fallos++;
  };

  console.log("\n1. Bodega de despacho");
  const loc = await shopifyAdmin<{
    location: { id: string; name: string; fulfillsOnlineOrders: boolean; shipsInventory: boolean } | null;
  }>(
    `query($id:ID!){ location(id:$id){ id name fulfillsOnlineOrders shipsInventory } }`,
    { id: `gid://shopify/Location/${locationId}` },
  );
  check(!!loc.location, `location ${locationId} existe`, loc.location?.name);
  check(loc.location?.fulfillsOnlineOrders === true, "despacha pedidos online");
  check(loc.location?.shipsInventory === true, "envía inventario");

  console.log("\n2. Suscripciones de webhook");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const subs = await shopifyAdmin<{
    webhookSubscriptions: {
      nodes: { topic: string; endpoint: { callbackUrl?: string } }[];
    };
  }>(
    `{ webhookSubscriptions(first:50){ nodes { topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
  );
  const nuestras = subs.webhookSubscriptions.nodes.filter((s) =>
    s.endpoint.callbackUrl?.startsWith(appUrl),
  );
  check(nuestras.length >= 5, `${nuestras.length} suscripciones hacia ${appUrl || "(sin APP_URL)"}`);
  for (const t of ["PRODUCTS_UPDATE", "INVENTORY_LEVELS_UPDATE"]) {
    check(nuestras.some((s) => s.topic === t), `topic ${t}`);
  }

  console.log("\n3. Ajuste de inventario (compare-and-swap + idempotencia)");
  const [row] = await db.execute<{ inventory_item_id: string; title: string; available: number }>(sql`
    SELECT il.inventory_item_id, p.title, il.available
    FROM products p
    JOIN variants v ON v.product_id = p.shopify_id
    JOIN inventory_levels il ON il.inventory_item_id = v.inventory_item_id
    WHERE il.location_id = ${locationId} AND il.available BETWEEN 20 AND 500
    ORDER BY il.available DESC LIMIT 1`);
  if (!row) throw new Error("No hay productos con stock suficiente para la prueba");

  const iid = Number(row.inventory_item_id);
  console.log(`  producto: ${row.title} (inventory_item ${iid})`);

  const inicial = (await getInventoryQuantities([iid], locationId)).get(iid);
  if (inicial == null) throw new Error("No se pudo leer la cantidad inicial");
  console.log(`  stock inicial en Shopify: ${inicial}`);

  const keySubida = `verify-${randomUUID()}`;
  await adjustInventory(
    [{ inventoryItemId: iid, locationId, delta: 1, changeFromQuantity: inicial }],
    "correction",
    `${appUrl}/verificacion`,
    keySubida,
  );
  const trasSubir = (await getInventoryQuantities([iid], locationId)).get(iid);
  check(trasSubir === inicial + 1, "+1 aplicado", `${inicial} → ${trasSubir}`);

  // Reintentar el MISMO ajuste debe ser rechazado por el compare-and-swap:
  // esa es la garantía de exactamente-una-vez que protege del doble descuento.
  let rechazado = false;
  try {
    await adjustInventory(
      [{ inventoryItemId: iid, locationId, delta: 1, changeFromQuantity: inicial }],
      "correction",
      `${appUrl}/verificacion`,
      keySubida,
    );
  } catch (err) {
    rechazado = /changeFromQuantity|no longer matches|persisted quantity/i.test(String(err));
  }
  const trasRepetir = (await getInventoryQuantities([iid], locationId)).get(iid);
  check(rechazado, "el replay del mismo ajuste es rechazado (CAS)");
  check(trasRepetir === inicial + 1, "el stock NO se duplicó", `sigue en ${trasRepetir}`);

  console.log("\n4. Webhook → espejo");
  let espejo: number | null = null;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const [r] = await db.execute<{ available: number }>(sql`
      SELECT available FROM inventory_levels
      WHERE inventory_item_id = ${iid} AND location_id = ${locationId}`);
    espejo = Number(r?.available);
    if (espejo === inicial + 1) {
      check(true, "webhook actualizó el espejo", `${espejo} tras ${(i + 1) * 2}s`);
      break;
    }
  }
  if (espejo !== inicial + 1) check(false, "webhook no llegó en 40s", `espejo = ${espejo}`);

  console.log("\n5. Restaurando stock original");
  await adjustInventory(
    [{ inventoryItemId: iid, locationId, delta: -1, changeFromQuantity: inicial + 1 }],
    "correction",
    `${appUrl}/verificacion`,
    `verify-${randomUUID()}`,
  );
  const final = (await getInventoryQuantities([iid], locationId)).get(iid);
  check(final === inicial, "stock restaurado", `${final} (original ${inicial})`);

  console.log(fallos === 0 ? "\n✓ ESPEJO CON SHOPIFY VERIFICADO\n" : `\n✗ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 500));
  process.exit(1);
});
