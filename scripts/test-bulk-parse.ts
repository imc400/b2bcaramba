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
 *  - Los metacampos (objetos anidados no-conexión) vienen INLINE en la línea
 *    del producto: edadColecciones.value es un string JSON array con espacios
 *    ("0 - 12 meses", "2 - 4 años") y ageGroup.value es el GID de un
 *    metaobjeto. Un producto sin metacampo trae null (o la clave ausente).
 *
 * Uso: pnpm tsx scripts/test-bulk-parse.ts
 */
import assert from "node:assert";
import { parseAgeRangesValue, parseBulkCatalogLines } from "../src/lib/shopify/bulk-parse";

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
    edadColecciones: { value: '["2 - 4 años","4 - 6 años"]' },
    ageGroup: { value: "gid://shopify/Metaobject/987" },
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
  // Producto 2: UNLISTED, sin media y SIN metacampos (claves ausentes)
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
  // Producto 3: metacampo de edad con JSON MALFORMADO (dato sucio real:
  // alguien escribió el tramo a mano en vez de la lista) + ageGroup null.
  // El parser debe degradar a [] sin romper el sync.
  JSON.stringify({
    id: "gid://shopify/Product/113",
    handle: "puzzle-dinos",
    title: "Puzzle Dinosaurios",
    descriptionHtml: null,
    vendor: "Caramba",
    productType: "Puzzles",
    category: null,
    tags: [],
    edadColecciones: { value: "6 - 8 años" },
    ageGroup: null,
    status: "ACTIVE",
    updatedAt: "2026-07-03T10:00:00Z",
    featuredMedia: null,
  }),
];

// Orden invertido: el parser NO debe depender del orden del JSONL
for (const input of [lines, [...lines].reverse()]) {
  const parsed = parseBulkCatalogLines(input);

  assert.equal(parsed.products.length, 3, "3 productos");
  assert.equal(parsed.variants.length, 1, "1 variante");
  assert.equal(parsed.levels.length, 2, "2 niveles de inventario (2 bodegas)");

  const p1 = parsed.products.find((p) => p.shopifyId === 111)!;
  assert.equal(p1.images.length, 2, "featured + galería = 2 imágenes");
  assert.equal(p1.featuredImageUrl, "https://cdn.shopify.com/a.jpg");
  assert.deepEqual(p1.tags, ["2-4 años", "peluche"]);
  assert.equal(p1.category, "Toys & Games > Stuffed Animals");
  assert.deepEqual(
    p1.ageRanges,
    ["2 - 4 años", "4 - 6 años"],
    "edad_para_colecciones: varios tramos, con espacios",
  );
  assert.equal(p1.recommendedAgeGid, "gid://shopify/Metaobject/987", "GID del age-group");

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
  assert.deepEqual(p2.ageRanges, [], "sin metacampo de edad → []");
  assert.equal(p2.recommendedAgeGid, null, "sin age-group → null");

  const p3 = parsed.products.find((p) => p.shopifyId === 113)!;
  assert.deepEqual(p3.ageRanges, [], "JSON malformado → [] sin romper");
  assert.equal(p3.recommendedAgeGid, null, "age-group null → null");
}

// parseAgeRangesValue: casos defensivos adicionales
assert.deepEqual(parseAgeRangesValue('["0 - 12 meses"]'), ["0 - 12 meses"]);
assert.deepEqual(
  parseAgeRangesValue('["2 - 4 años","2 - 4 años"," 4 - 6 años ",""]'),
  ["2 - 4 años", "4 - 6 años"],
  "dedup + trim + descarta vacíos",
);
assert.deepEqual(parseAgeRangesValue('"6 - 8 años"'), ["6 - 8 años"], "string JSON suelto → [str]");
assert.deepEqual(parseAgeRangesValue('{"no":"lista"}'), [], "JSON no-lista → []");
assert.deepEqual(parseAgeRangesValue("[1,2]"), [], "lista sin strings → []");
assert.deepEqual(parseAgeRangesValue(null), []);
assert.deepEqual(parseAgeRangesValue(undefined), []);
assert.deepEqual(parseAgeRangesValue(""), []);

console.log(
  "✓ parseBulkCatalogLines + parseAgeRangesValue: todos los asserts pasaron (orden normal e invertido)",
);
