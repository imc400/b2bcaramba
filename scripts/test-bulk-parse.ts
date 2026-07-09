/**
 * Test del parser de JSONL de Bulk Operations.
 *
 * IMPORTANTE: los datos replican el formato REAL que emite Shopify, verificado
 * contra caramba-juguetes (19 MB, 46.507 objetos):
 *  - Los hijos de conexiones anidadas NO traen `id` cuando el tipo no lo expone:
 *    las imágenes de galería llegan como {image, __parentId} y los niveles de
 *    inventario como {location, quantities, updatedAt, __parentId}.
 *  - `__parentId` de un InventoryLevel es el gid de la VARIANTE.
 *  - El status puede ser UNLISTED, además de ACTIVE/ARCHIVED/DRAFT.
 *
 * Uso: pnpm tsx scripts/test-bulk-parse.ts
 */
import assert from "node:assert";
import { parseBulkCatalogLines } from "../src/lib/shopify/bulk-parse";

const lines = [
  // Producto 1
  JSON.stringify({
    id: "gid://shopify/Product/111",
    handle: "peluche-zorro",
    title: "Peluche Zorro",
    descriptionHtml: "<p>Suave</p>",
    vendor: "Jellycat",
    productType: "Peluches",
    category: { fullName: "Toys & Games > Stuffed Animals" },
    tags: ["2-4 años", "peluche"],
    status: "ACTIVE",
    updatedAt: "2026-07-01T10:00:00Z",
    featuredMedia: {
      image: { url: "https://cdn.shopify.com/a.jpg", altText: null, width: 800, height: 800 },
    },
  }),
  // Imagen de galería: SIN id, solo image + __parentId
  JSON.stringify({
    __parentId: "gid://shopify/Product/111",
    image: { url: "https://cdn.shopify.com/b.jpg", altText: "lado", width: 800, height: 800 },
  }),
  // Nodo de media vacío (video u otro tipo): debe ignorarse sin romper
  JSON.stringify({ __parentId: "gid://shopify/Product/111" }),
  // Variante
  JSON.stringify({
    id: "gid://shopify/ProductVariant/222",
    __parentId: "gid://shopify/Product/111",
    title: "Default Title",
    sku: "ZORRO-1",
    price: "15990",
    compareAtPrice: null,
    position: 1,
    availableForSale: true,
    updatedAt: "2026-07-01T10:00:00Z",
    image: null,
    inventoryItem: { id: "gid://shopify/InventoryItem/333" },
  }),
  // Niveles de inventario: SIN id, __parentId = gid de la VARIANTE
  JSON.stringify({
    __parentId: "gid://shopify/ProductVariant/222",
    location: { id: "gid://shopify/Location/35186606180" },
    quantities: [{ name: "available", quantity: 7 }],
    updatedAt: "2026-07-01T10:05:00Z",
  }),
  JSON.stringify({
    __parentId: "gid://shopify/ProductVariant/222",
    location: { id: "gid://shopify/Location/75488788580" },
    quantities: [{ name: "available", quantity: 3 }],
    updatedAt: "2026-07-01T10:05:00Z",
  }),
  "", // línea vacía
  // Producto 2: UNLISTED, sin media
  JSON.stringify({
    id: "gid://shopify/Product/112",
    handle: "libro-cuentos",
    title: "Libro de Cuentos",
    descriptionHtml: null,
    vendor: "Librería Caramba",
    productType: "Libros",
    category: null,
    tags: [],
    status: "UNLISTED",
    updatedAt: "2026-07-02T10:00:00Z",
    featuredMedia: null,
  }),
];

// Orden invertido: el parser NO debe depender del orden del JSONL
for (const input of [lines, [...lines].reverse()]) {
  const parsed = parseBulkCatalogLines(input);

  assert.equal(parsed.products.length, 2, "2 productos");
  assert.equal(parsed.variants.length, 1, "1 variante");
  assert.equal(parsed.levels.length, 2, "2 niveles de inventario (2 bodegas)");

  const p1 = parsed.products.find((p) => p.shopifyId === 111)!;
  assert.equal(p1.images.length, 2, "featured + galería = 2 imágenes");
  assert.equal(p1.featuredImageUrl, "https://cdn.shopify.com/a.jpg");
  assert.deepEqual(p1.tags, ["2-4 años", "peluche"]);
  assert.equal(p1.category, "Toys & Games > Stuffed Animals");

  const v = parsed.variants[0];
  assert.equal(v.productId, 111);
  assert.equal(v.inventoryItemId, 333);
  assert.equal(v.priceClp, 15990);

  const bodega = parsed.levels.find((l) => l.locationId === 35186606180)!;
  assert.equal(bodega.inventoryItemId, 333, "level asociado vía __parentId de la variante");
  assert.equal(bodega.available, 7);
  const tienda = parsed.levels.find((l) => l.locationId === 75488788580)!;
  assert.equal(tienda.available, 3, "la tienda física tiene su propio stock");

  const p2 = parsed.products.find((p) => p.shopifyId === 112)!;
  assert.equal(p2.featuredImageUrl, null);
  assert.equal(p2.status, "UNLISTED");
}

console.log("✓ parseBulkCatalogLines: todos los asserts pasaron (orden normal e invertido)");
