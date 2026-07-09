/**
 * Registra (o corrige) las suscripciones de webhook de Shopify.
 *
 *   pnpm webhooks:list      # muestra las suscripciones actuales
 *   pnpm webhooks:register  # crea las que faltan, corrige URLs, borra sobrantes
 *
 * Idempotente: correrlo dos veces no duplica nada. Se usa en vez de declararlos
 * en shopify.app.toml porque así podemos verificar contra la API que quedaron
 * activos, y porque las suscripciones declarativas no siempre se materializan
 * al publicar una versión.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const API_VERSION = "2026-07";

const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "INVENTORY_LEVELS_CONNECT",
  "INVENTORY_LEVELS_DISCONNECT",
  "INVENTORY_ITEMS_DELETE",
] as const;

type Subscription = {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string };
};

async function graphql<T>(token: string, query: string, variables?: object): Promise<T> {
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data as T;
}

async function listSubscriptions(token: string): Promise<Subscription[]> {
  const d = await graphql<{ webhookSubscriptions: { nodes: Subscription[] } }>(
    token,
    `{ webhookSubscriptions(first: 100) {
         nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
       } }`,
  );
  return d.webhookSubscriptions.nodes;
}

async function main() {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN no definida");
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL no definida");
  if (appUrl.includes("localhost")) {
    throw new Error("Shopify no puede entregar webhooks a localhost. Usa la URL de producción.");
  }
  const callbackUrl = `${appUrl}/api/webhooks/shopify`;
  const soloListar = process.argv.includes("--list");

  const actuales = await listSubscriptions(token);
  console.log(`Suscripciones actuales: ${actuales.length}`);
  for (const s of actuales) {
    console.log(`  ${s.topic.padEnd(28)} → ${s.endpoint.callbackUrl ?? s.endpoint.__typename}`);
  }
  if (soloListar) return;

  console.log(`\nDestino: ${callbackUrl}\n`);

  // Sobrantes: mismo topic pero URL distinta (p.ej. de un deploy anterior)
  for (const s of actuales) {
    const esNuestro = s.endpoint.callbackUrl === callbackUrl;
    const topicNecesario = (TOPICS as readonly string[]).includes(s.topic);
    if (!esNuestro || !topicNecesario) {
      const d = await graphql<{ webhookSubscriptionDelete: { userErrors: { message: string }[] } }>(
        token,
        `mutation ($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`,
        { id: s.id },
      );
      const errs = d.webhookSubscriptionDelete.userErrors;
      console.log(`  - eliminada ${s.topic}${errs.length ? ` (${errs[0].message})` : ""}`);
    }
  }

  const vigentes = new Set(
    actuales.filter((s) => s.endpoint.callbackUrl === callbackUrl).map((s) => s.topic),
  );

  for (const topic of TOPICS) {
    if (vigentes.has(topic)) {
      console.log(`  = ${topic} ya registrado`);
      continue;
    }
    const d = await graphql<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      token,
      `mutation ($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
         webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
           webhookSubscription { id }
           userErrors { field message }
         }
       }`,
      { topic, sub: { callbackUrl, format: "JSON" } },
    );
    const r = d.webhookSubscriptionCreate;
    if (r.userErrors.length) {
      console.log(`  ✗ ${topic}: ${r.userErrors.map((e) => e.message).join("; ")}`);
    } else {
      console.log(`  + ${topic} registrado`);
    }
  }

  const finales = await listSubscriptions(token);
  const nuestras = finales.filter((s) => s.endpoint.callbackUrl === callbackUrl);
  console.log(`\n✓ ${nuestras.length}/${TOPICS.length} suscripciones activas hacia ${callbackUrl}`);
  if (nuestras.length !== TOPICS.length) process.exit(1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
