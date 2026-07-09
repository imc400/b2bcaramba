import "server-only";
import { shopifyAdmin } from "./client";
import { numericId } from "./gid";

export { numericId } from "./gid";

// ---------------------------------------------------------------------------
// Fragmento de producto usado por sync individual (webhook/reconciliación)
// ---------------------------------------------------------------------------

export const PRODUCT_SYNC_QUERY = /* GraphQL */ `
  query ProductSync($id: ID!) {
    product(id: $id) {
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
      featuredMedia {
        ... on MediaImage {
          image { url altText width height }
        }
      }
      media(first: 20) {
        nodes {
          ... on MediaImage {
            image { url altText width height }
          }
        }
      }
      variants(first: 100) {
        nodes {
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
            # Sin esto la reconciliación horaria nunca repararía el stock:
            # un webhook de inventario perdido dejaba el espejo desviado
            # hasta el full-sync semanal.
            inventoryLevels(first: 10) {
              nodes {
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
`;

// ---------------------------------------------------------------------------
// Bulk operation: catálogo completo (sync inicial + full-resync semanal)
// ---------------------------------------------------------------------------

export const BULK_CATALOG_QUERY = /* GraphQL */ `
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
          featuredMedia {
            ... on MediaImage { image { url altText width height } }
          }
          media {
            edges {
              node {
                ... on MediaImage { image { url altText width height } }
              }
            }
          }
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
  }
`;

export async function startBulkCatalogSync(): Promise<string> {
  const data = await shopifyAdmin<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    /* GraphQL */ `
      mutation StartBulk($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `,
    { query: BULK_CATALOG_QUERY },
  );
  const op = data.bulkOperationRunQuery;
  if (op.userErrors.length) {
    throw new Error(`bulkOperationRunQuery: ${op.userErrors.map((e) => e.message).join("; ")}`);
  }
  if (!op.bulkOperation) throw new Error("bulkOperationRunQuery no devolvió operación");
  return op.bulkOperation.id;
}

export async function getBulkOperationStatus(): Promise<{
  id: string;
  status: string;
  url: string | null;
  errorCode: string | null;
  objectCount: string;
} | null> {
  const data = await shopifyAdmin<{
    currentBulkOperation: {
      id: string;
      status: string;
      url: string | null;
      errorCode: string | null;
      objectCount: string;
    } | null;
  }>(/* GraphQL */ `
    query {
      currentBulkOperation(type: QUERY) {
        id
        status
        url
        errorCode
        objectCount
      }
    }
  `);
  return data.currentBulkOperation;
}

// ---------------------------------------------------------------------------
// Ajuste de inventario: descuento de stock al confirmar un pedido B2B.
// Devuelve las cantidades resultantes para detectar carreras con la venta B2C.
// ---------------------------------------------------------------------------

export type InventoryAdjustment = {
  inventoryItemId: number;
  locationId: number;
  delta: number;
  /**
   * Cantidad que creemos que hay ahora. Desde la API 2026-07 es OBLIGATORIA:
   * Shopify aplica compare-and-swap y rechaza el ajuste si el stock cambió
   * entre nuestra lectura y la escritura. Es exactamente la protección que
   * queremos contra una venta B2C simultánea.
   */
  changeFromQuantity: number;
};

/** Cantidades `available` actuales en Shopify (fuente de verdad). */
export async function getInventoryQuantities(
  inventoryItemIds: number[],
  locationId: number,
): Promise<Map<number, number>> {
  if (inventoryItemIds.length === 0) return new Map();
  const data = await shopifyAdmin<{
    nodes: ({
      id: string;
      inventoryLevel: { quantities: { name: string; quantity: number }[] } | null;
    } | null)[];
  }>(
    /* GraphQL */ `
      query InventoryQuantities($ids: [ID!]!, $locationId: ID!) {
        nodes(ids: $ids) {
          ... on InventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    `,
    {
      ids: inventoryItemIds.map((id) => `gid://shopify/InventoryItem/${id}`),
      locationId: `gid://shopify/Location/${locationId}`,
    },
  );

  const map = new Map<number, number>();
  for (const node of data.nodes) {
    if (!node?.inventoryLevel) continue;
    const available = node.inventoryLevel.quantities.find((q) => q.name === "available");
    if (available) map.set(numericId(node.id), available.quantity);
  }
  return map;
}

/**
 * Ajusta inventario en Shopify.
 *
 * `idempotencyKey` es OBLIGATORIA desde la API 2026-04 (directiva @idempotent).
 * Deriva del pedido y del sentido del ajuste, de modo que un reintento —de
 * Inngest, de un timeout o de un doble click— no descuenta el stock dos veces.
 */
export async function adjustInventory(
  adjustments: InventoryAdjustment[],
  reason: "correction" | "restock" = "correction",
  referenceUri: string | undefined,
  idempotencyKey: string,
): Promise<{ inventoryItemId: number; locationId: number; resultingQuantity: number }[]> {
  const data = await shopifyAdmin<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: {
        changes: {
          item: { id: string };
          location: { id: string };
          delta: number;
          quantityAfterChange: number | null;
        }[];
      } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    /* GraphQL */ `
      mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
        inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          inventoryAdjustmentGroup {
            changes {
              item { id }
              location { id }
              delta
              quantityAfterChange
            }
          }
          userErrors { field message }
        }
      }
    `,
    {
      idempotencyKey,
      input: {
        reason,
        name: "available",
        referenceDocumentUri: referenceUri,
        changes: adjustments.map((a) => ({
          inventoryItemId: `gid://shopify/InventoryItem/${a.inventoryItemId}`,
          locationId: `gid://shopify/Location/${a.locationId}`,
          delta: a.delta,
          changeFromQuantity: a.changeFromQuantity,
        })),
      },
    },
  );

  const result = data.inventoryAdjustQuantities;
  if (result.userErrors.length) {
    throw new Error(
      `inventoryAdjustQuantities: ${result.userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  return (result.inventoryAdjustmentGroup?.changes ?? []).map((c) => ({
    inventoryItemId: numericId(c.item.id),
    locationId: numericId(c.location.id),
    resultingQuantity: c.quantityAfterChange ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Reconciliación incremental: productos modificados desde un checkpoint
// ---------------------------------------------------------------------------

export const RECONCILIATION_QUERY = /* GraphQL */ `
  query ChangedProducts($query: String!, $cursor: String) {
    products(first: 50, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id updatedAt }
    }
  }
`;

