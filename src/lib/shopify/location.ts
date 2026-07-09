/**
 * Bodega contra la que se lee y descuenta el stock B2B.
 *
 * La tienda tiene 5 locations (3PL, Espacio Urbano La Dehesa, La Forja 8600,
 * Los Trapenses, Luis Pasteur) pero solo "La Forja 8600" tiene
 * fulfillsOnlineOrders + shipsInventory. Filtrar por esta location es
 * OBLIGATORIO: sin el filtro, el catálogo sumaría el stock de las tiendas
 * físicas y prometeríamos unidades que la bodega no puede despachar.
 */
export function getFulfillmentLocationId(): number {
  const raw = process.env.SHOPIFY_LOCATION_ID;
  if (!raw) throw new Error("SHOPIFY_LOCATION_ID no está definida");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`SHOPIFY_LOCATION_ID inválida: ${raw}`);
  }
  return id;
}
