import "server-only";
import { getAdminAccessToken } from "./token";

const API_VERSION = "2026-07";

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
};

function endpoint(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN no está definida");
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
}

/**
 * Ejecuta una operación contra la Admin GraphQL API con reintentos.
 * - THROTTLED: espera según el restoreRate reportado y reintenta.
 * - Errores de red / 5xx: backoff exponencial.
 */
export async function shopifyAdmin<T>(
  query: string,
  variables?: Record<string, unknown>,
  { maxRetries = 5 }: { maxRetries?: number } = {},
): Promise<T> {
  const token = await getAdminAccessToken();
  if (!token) {
    throw new Error(
      "Sin token de Admin API: define SHOPIFY_ADMIN_ACCESS_TOKEN o completa el OAuth en /api/auth/shopify/install",
    );
  }

  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      if (attempt > maxRetries) throw err;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (res.status >= 500 || res.status === 429) {
      if (attempt > maxRetries) {
        throw new Error(`Shopify Admin API HTTP ${res.status} tras ${attempt} intentos`);
      }
      const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt * 0.5;
      await sleep(retryAfter * 1000);
      continue;
    }

    const body = (await res.json()) as GraphQLResponse<T>;

    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled) {
      if (attempt > maxRetries) {
        throw new Error(`Shopify Admin API THROTTLED tras ${attempt} intentos`);
      }
      const cost = body.extensions?.cost;
      const waitMs = cost
        ? Math.max(
            ((cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable) /
              cost.throttleStatus.restoreRate) *
              1000,
            500,
          )
        : 2 ** attempt * 500;
      await sleep(waitMs);
      continue;
    }

    if (body.errors?.length) {
      throw new Error(
        `Shopify Admin API GraphQL: ${body.errors.map((e) => e.message).join("; ")}`,
      );
    }
    if (!body.data) throw new Error("Shopify Admin API: respuesta sin data");
    return body.data;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export { API_VERSION };
