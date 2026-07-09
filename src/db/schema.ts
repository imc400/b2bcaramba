import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Espejo de Shopify (products, variants, inventory)
// La fuente de verdad es Shopify; estas tablas son la réplica local que
// alimenta los microsites. Se escriben SOLO desde el pipeline de sync
// (bulk + webhooks + reconciliación), nunca desde el panel.
// ---------------------------------------------------------------------------

// UNLISTED existe en tiendas reales (producto publicado pero no listado)
export const productStatusEnum = pgEnum("product_status", [
  "ACTIVE",
  "ARCHIVED",
  "DRAFT",
  "UNLISTED",
]);

export const products = pgTable(
  "products",
  {
    // GID numérico de Shopify (gid://shopify/Product/<id>)
    shopifyId: bigint("shopify_id", { mode: "number" }).primaryKey(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html"),
    vendor: text("vendor"),
    productType: text("product_type"),
    category: text("category"),
    tags: text("tags").array().notNull().default([]),
    status: productStatusEnum("status").notNull(),
    featuredImageUrl: text("featured_image_url"),
    // [{ url, altText, width, height }] en orden de Shopify
    images: jsonb("images")
      .$type<{ url: string; altText: string | null; width: number; height: number }[]>()
      .notNull()
      .default([]),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_status_idx").on(t.status),
    index("products_tags_idx").using("gin", t.tags),
  ],
);

export const variants = pgTable(
  "variants",
  {
    shopifyId: bigint("shopify_id", { mode: "number" }).primaryKey(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.shopifyId, { onDelete: "cascade" }),
    inventoryItemId: bigint("inventory_item_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    sku: text("sku"),
    // CLP: entero, sin decimales
    priceClp: integer("price_clp").notNull(),
    compareAtPriceClp: integer("compare_at_price_clp"),
    position: integer("position").notNull().default(1),
    imageUrl: text("image_url"),
    availableForSale: boolean("available_for_sale").notNull().default(true),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    uniqueIndex("variants_inventory_item_idx").on(t.inventoryItemId),
    index("variants_price_idx").on(t.priceClp),
  ],
);

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    inventoryItemId: bigint("inventory_item_id", { mode: "number" }).notNull(),
    locationId: bigint("location_id", { mode: "number" }).notNull(),
    available: integer("available").notNull().default(0),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.inventoryItemId, t.locationId] })],
);

// ---------------------------------------------------------------------------
// Multi-tenant: empresas, campañas, colaboradores
// companyId es el tenant_id de RLS en todas las tablas con datos de empresa.
// ---------------------------------------------------------------------------

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // slug del link: app.caramba.cl/<slug>
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_slug_idx").on(t.slug)],
);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "closed",
]);

/**
 * Filtro de catálogo de una campaña. Se evalúa contra el espejo local.
 * Todos los criterios son opcionales y se combinan con AND;
 * dentro de cada lista el match es OR (cualquiera de los tags, etc.).
 */
export type CatalogFilter = {
  tags?: string[];
  excludedTags?: string[];
  productTypes?: string[];
  vendors?: string[];
  priceMinClp?: number;
  priceMaxClp?: number;
  includeProductIds?: number[];
  excludeProductIds?: number[];
};

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    bannerTitle: text("banner_title").notNull(),
    bannerSubtitle: text("banner_subtitle"),
    bannerImageUrl: text("banner_image_url"),
    // Tema visual del microsite (color de acento, etc.) — co-branding editable
    theme: jsonb("theme").$type<{ accentColor?: string; bannerBg?: string }>(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    catalogFilter: jsonb("catalog_filter").$type<CatalogFilter>().notNull().default({}),
    // Cupo por defecto para colaboradores importados sin cupo explícito
    defaultQuota: integer("default_quota").notNull().default(1),
    // No mostrar productos con stock <= umbral (stock de seguridad)
    safetyStock: integer("safety_stock").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_company_idx").on(t.companyId)],
);

export const collaborators = pgTable(
  "collaborators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    email: text("email"),
    // RUT normalizado sin puntos, con guión y DV minúscula: "12345678-9"
    rut: text("rut"),
    name: text("name"),
    quota: integer("quota").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collaborators_campaign_idx").on(t.campaignId),
    uniqueIndex("collaborators_campaign_email_idx").on(t.campaignId, t.email),
    uniqueIndex("collaborators_campaign_rut_idx").on(t.campaignId, t.rut),
    index("collaborators_company_idx").on(t.companyId),
  ],
);

// ---------------------------------------------------------------------------
// Autenticación de colaboradores: OTP por correo + sesiones opacas
// ---------------------------------------------------------------------------

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => collaborators.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otp_codes_collaborator_idx").on(t.collaboratorId)],
);

export const sessions = pgTable(
  "sessions",
  {
    // sha256 del token opaco; el token viaja solo en la cookie HttpOnly
    tokenHash: text("token_hash").primaryKey(),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => collaborators.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_collaborator_idx").on(t.collaboratorId)],
);

// ---------------------------------------------------------------------------
// Pedidos: viven en la plataforma (no en Shopify).
// Al confirmar, el stock se descuenta en Shopify vía inventoryAdjustQuantities.
// ---------------------------------------------------------------------------

export const orderStatusEnum = pgEnum("order_status", [
  "por_preparar",
  "preparando",
  "despachado",
  "anulado",
  "requiere_revision",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Código humano correlativo por año: CB-2026-000123
    code: text("code").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => collaborators.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull().default("por_preparar"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    addressLine: text("address_line").notNull(),
    comuna: text("comuna").notNull(),
    region: text("region"),
    addressNotes: text("address_notes"),
    internalNotes: text("internal_notes"),
    // Si el ajuste de stock en Shopify dejó cantidades negativas u otro problema
    stockIssue: jsonb("stock_issue").$type<{
      variantId: number;
      resultingQuantity: number;
      detectedAt: string;
    } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_code_idx").on(t.code),
    index("orders_company_idx").on(t.companyId),
    index("orders_campaign_idx").on(t.campaignId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // Snapshot al momento del pedido — el espejo puede cambiar después
    productShopifyId: bigint("product_shopify_id", { mode: "number" }).notNull(),
    variantShopifyId: bigint("variant_shopify_id", { mode: "number" }).notNull(),
    inventoryItemId: bigint("inventory_item_id", { mode: "number" }).notNull(),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title"),
    imageUrl: text("image_url"),
    // Precio interno de referencia para reportería (el colaborador nunca lo ve)
    priceClp: integer("price_clp").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Notificaciones de pedidos: destinatarios configurables desde el panel.
// companyId null = destinatario global (recibe pedidos de todas las empresas).
// ---------------------------------------------------------------------------

export const notificationRecipients = pgTable(
  "notification_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_recipients_company_idx").on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Infraestructura de sync
// ---------------------------------------------------------------------------

// Dedup de webhooks (entrega at-least-once): un registro por X-Shopify-Webhook-Id
export const webhookEvents = pgTable(
  "webhook_events",
  {
    webhookId: text("webhook_id").primaryKey(),
    topic: text("topic").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("webhook_events_received_idx").on(t.receivedAt)],
);

// Checkpoints del pipeline (última reconciliación, último bulk, etc.)
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Auditoría de acciones del panel (quién cambió qué)
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);
