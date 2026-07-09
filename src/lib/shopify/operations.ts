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
};

export async function adjustInventory(
  adjustments: InventoryAdjustment[],
  reason: "correction" | "restock" = "correction",
  referenceUri?: string,
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
      mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
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
      input: {
        reason,
        name: "available",
        referenceDocumentUri: referenceUri,
        changes: adjustments.map((a) => ({
          inventoryItemId: `gid://shopify/InventoryItem/${a.inventoryItemId}`,
          locationId: `gid://shopify/Location/${a.locationId}`,
          delta: a.delta,
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

