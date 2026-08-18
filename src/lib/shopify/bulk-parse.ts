/**
 * Parser puro del JSONL de Bulk Operations (sin dependencias de servidor,
 * testeable de forma aislada). La ingesta con DB vive en bulk-ingest.ts.
 */
import { numericId } from "./gid";

type ImageNode = { url: string; altText: string | null; width: number; height: number };

type ParsedProduct = {
  shopifyId: number;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  category: string | null;
  tags: string[];
  /** Tramos de custom.edad_para_colecciones ("0 - 12 meses", "2 - 4 años", …) */
  ageRanges: string[];
  /** GID del metaobjeto custom.age-group; se resuelve a texto en la ingesta */
  recommendedAgeGid: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
  images: ImageNode[];
  featuredImageUrl: string | null;
  shopifyUpdatedAt: Date;
};

type ParsedVariant = {
  shopifyId: number;
  productId: number;
  inventoryItemId: number;
  title: string;
  sku: string | null;
  priceClp: number;
  compareAtPriceClp: number | null;
  position: number;
  imageUrl: string | null;
  availableForSale: boolean;
  shopifyUpdatedAt: Date;
};

type ParsedLevel = {
  inventoryItemId: number;
  locationId: number;
  available: number;
  shopifyUpdatedAt: Date;
};

export type ParsedCatalog = {
  products: ParsedProduct[];
  variants: ParsedVariant[];
  levels: ParsedLevel[];
};

/**
 * Valor crudo de custom.edad_para_colecciones → tramos limpios.
 * El metacampo es list.single_line_text_field: su value llega como string
 * JSON ('["2 - 4 años","4 - 6 años"]'). Defensivo: un JSON malformado, un
 * string suelto o tipos inesperados no rompen el sync — se degrada a [].
 */
export function parseAgeRangesValue(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") return parsed.trim() ? [parsed.trim()] : [];
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

/** Parsea las líneas del JSONL a estructuras planas listas para upsert. */
export function parseBulkCatalogLines(lines: Iterable<string>): ParsedCatalog {
  const productsById = new Map<number, ParsedProduct>();
  const variantsById = new Map<number, ParsedVariant>();
  const levels: ParsedLevel[] = [];
  // gid de variante → inventoryItemId (para asociar los levels anidados)
  const variantInventoryItem = new Map<string, number>();
  // productId → imágenes de galería, se adjuntan al final (no dependemos de
  // que el producto aparezca antes que sus imágenes)
  const galleryByProduct = new Map<number, ImageNode[]>();

  // Materializamos: hacemos dos pasadas (no dependemos del orden del JSONL).
  const allLines = [...lines].map((l) => l.trim()).filter(Boolean);

  // Pasada 1: variante -> inventoryItemId, para asociar sus InventoryLevel.
  for (const line of allLines) {
    const node = JSON.parse(line) as { id?: string; inventoryItem?: { id: string } };
    if (node.id?.includes("/ProductVariant/") && node.inventoryItem) {
      variantInventoryItem.set(node.id, numericId(node.inventoryItem.id));
    }
  }

  // Pasada 2: construir productos, variantes, imágenes y niveles de stock.
  for (const line of allLines) {
    const node = JSON.parse(line) as Record<string, unknown> & {
      id?: string;
      __parentId?: string;
    };

    // OJO: en el JSONL de Bulk Operations los hijos de conexiones anidadas
    // NO traen `id` cuando el tipo no lo expone (MediaImage.image, los
    // InventoryLevel). Se identifican por sus campos + __parentId.
    if (!node.id) {
      if (!node.__parentId) continue;

      // Imagen de galería del producto
      if ("image" in node && node.image) {
        const productId = numericId(node.__parentId);
        const list = galleryByProduct.get(productId) ?? [];
        list.push(node.image as ImageNode);
        galleryByProduct.set(productId, list);
        continue;
      }

      // Nivel de inventario de una variante
      if ("location" in node && "quantities" in node) {
        const il = node as unknown as {
          __parentId: string;
          location: { id: string };
          quantities: { name: string; quantity: number }[];
          updatedAt: string;
        };
        const inventoryItemId = variantInventoryItem.get(il.__parentId);
        if (inventoryItemId == null) continue;
        levels.push({
          inventoryItemId,
          locationId: numericId(il.location.id),
          available: il.quantities.find((q) => q.name === "available")?.quantity ?? 0,
          shopifyUpdatedAt: new Date(il.updatedAt),
        });
        continue;
      }
      continue; // nodo vacío (p.ej. media que no es imagen)
    }

    if (node.id.includes("/Product/") && !node.__parentId) {
      const p = node as unknown as {
        id: string;
        handle: string;
        title: string;
        descriptionHtml: string | null;
        vendor: string | null;
        productType: string | null;
        category: { fullName: string } | null;
        tags: string[];
        edadColecciones: { value: string | null } | null;
        ageGroup: { value: string | null } | null;
        status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
        updatedAt: string;
        featuredMedia: { image: ImageNode | null } | null;
      };
      productsById.set(numericId(p.id), {
        shopifyId: numericId(p.id),
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        vendor: p.vendor,
        productType: p.productType || null,
        category: p.category?.fullName ?? null,
        tags: p.tags ?? [],
        ageRanges: parseAgeRangesValue(p.edadColecciones?.value),
        recommendedAgeGid: p.ageGroup?.value?.trim() || null,
        status: p.status,
        images: p.featuredMedia?.image ? [p.featuredMedia.image] : [],
        featuredImageUrl: p.featuredMedia?.image?.url ?? null,
        shopifyUpdatedAt: new Date(p.updatedAt),
      });
      continue;
    }

    if (node.id.includes("/ProductVariant/")) {
      const v = node as unknown as {
        id: string;
        __parentId: string;
        title: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
        position: number;
        availableForSale: boolean;
        updatedAt: string;
        image: { url: string } | null;
        inventoryItem: { id: string };
      };
      const variantId = numericId(v.id);
      const inventoryItemId = numericId(v.inventoryItem.id);
      variantInventoryItem.set(v.id, inventoryItemId);
      variantsById.set(variantId, {
        shopifyId: variantId,
        productId: numericId(v.__parentId),
        inventoryItemId,
        title: v.title,
        sku: v.sku,
        priceClp: Math.round(Number(v.price)),
        compareAtPriceClp: v.compareAtPrice ? Math.round(Number(v.compareAtPrice)) : null,
        position: v.position,
        imageUrl: v.image?.url ?? null,
        availableForSale: v.availableForSale,
        shopifyUpdatedAt: new Date(v.updatedAt),
      });
      continue;
    }
  }

  // Adjuntar la galería: sin duplicar la imagen destacada
  for (const [productId, gallery] of galleryByProduct) {
    const product = productsById.get(productId);
    if (!product) continue;
    for (const img of gallery) {
      if (!product.images.some((i) => i.url === img.url)) product.images.push(img);
    }
    product.featuredImageUrl ??= product.images[0]?.url ?? null;
  }

  return {
    products: [...productsById.values()],
    variants: [...variantsById.values()],
    levels,
  };
}

