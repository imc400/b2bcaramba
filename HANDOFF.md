# HANDOFF — Plataforma Caramba B2B

**Para el próximo agente/desarrollador (Opus 4.8).** Estado al 08-jul-2026, sesión de Fable 5.
Lee también: `../docs/decision-arquitectura.md` (por qué de cada decisión) y `../docs/brand-tokens.md` (design system oficial del Brandbook).

---

## 1. Qué funciona HOY (verificado E2E en local)

Flujo completo probado con Playwright-style en browser real:

1. **Microsite** `http://localhost:3002/entel` — acceso co-branded, identificación por **correo o RUT** (normalización + Módulo 11 en `src/lib/auth/rut.ts`), **OTP 6 dígitos** al correo (sin Resend key se loguea a consola del server), sesión opaca en cookie HttpOnly.
2. **Catálogo** sin precios, filtrado por la campaña (rango de precio/tags ocultos al colaborador), chips de edad y categoría desde tags reales de Shopify, stock de seguridad (no muestra productos con stock ≤ umbral), cupo visible y respetado.
3. **Pedido** transaccional (`src/lib/orders.ts`): lock de colaborador + lock de inventario, valida cupo y stock, descuenta espejo local, código correlativo `CB-2026-NNNNN`, evento Inngest → ajuste en Shopify + correos. Pedidos de prueba: CB-2026-00001, CB-2026-00002.
4. **Panel admin** `http://localhost:3002/admin` (password: `ADMIN_PASSWORD` en `.env.local`): Pedidos (stats, filtros por empresa/estado, cambio de estado con transiciones válidas, **export Excel real**), Empresas (crear/editar con preview de banner en vivo + conteo de productos que matchean el filtro), Colaboradores (**import .xlsx/.csv probado**, detección flexible de columnas, upsert, errores por fila), Productos (espejo, solo lectura), Ajustes (destinatarios de correo por empresa/global, estado de conexión Shopify, botón de sync).
5. **Pipeline de sync completo** (código listo, esperando token): receptor de webhooks con HMAC + dedup (`/api/webhooks/shopify`), funciones Inngest (`process-webhook` idempotente con descarte de eventos viejos, `reconcile` cada hora, `full-sync` semanal con **ingesta JSONL implementada y testeada** — `scripts/test-bulk-parse.ts` pasa).

`pnpm build`, `pnpm exec tsc --noEmit` y `pnpm lint` **verdes**.

## 2. Cómo correr

```bash
cd caramba-b2b
pnpm install
# Postgres 17 local ya corre via Homebrew; DB caramba_b2b ya migrada y seedeada
pnpm dev --port 3002        # 3000/3001 ocupados por otros proyectos de Ignacio
npx inngest-cli@latest dev  # opcional: para procesar eventos (pedidos funcionan sin él)
pnpm seed                   # re-seed: catálogo real de caramba.cl + demos
pnpm tsx scripts/test-bulk-parse.ts  # test del parser JSONL
```

Usuarios demo (campaña Entel): `juan.perez@entel.cl` (cupo agotado), `igblancora@gmail.com` / RUT `17.654.321-6` (cupo 2, usado 1), `m.soto@entel.cl`, `r.fuentes@entel.cl`. El código OTP aparece en la consola del dev server.

## 3. Shopify: RESUELTO (09-jul-2026)

La app **"Caramba B2B"** vive en la org de Partners **Clicklab** (`dev.shopify.com/dashboard/128991664/apps/394980851713`), no en el Dev Dashboard personal. Su config se versiona en `shopify.app.toml` y se publica con `pnpm shopify:deploy`.

- El **client credentials grant NO sirve** con esta app: la tienda no pertenece a la org (`shop_not_permitted`). Se usa el OAuth authorization code de `/api/auth/shopify/install`.
- Shopify exige que `redirect_urls` compartan host con `application_url`. En dev ambos apuntan a `localhost:3002`; **al desplegar hay que cambiar `application_url` a `https://app.caramba.cl` y republicar**.
- Token guardado en `sync_state.shopify_admin_token`. Scopes: `read_products, read_inventory, write_inventory, read_locations`. Plan de la tienda: rate limit 2000 pts (no Standard).
- **Bodega**: la tienda tiene 5 locations; solo **`La Forja 8600` (35186606180)** tiene `fulfillsOnlineOrders` + `shipsInventory`. `SHOPIFY_LOCATION_ID` en env; `getFulfillmentLocationId()` se usa para filtrar catálogo, curaduría y pedidos. **Sin ese filtro se sumaría el stock de las tiendas físicas.**
- `pnpm sync` hace el bulk sync completo (`--cache` reusa el JSONL de `/tmp/caramba-bulk.jsonl`). Resultado real: 5.074 productos, 3.839 activos, 25.246 niveles, 15.076 unidades en bodega, 924 productos con stock vendible.

### Gotchas del JSONL de Bulk Operations (descubiertos con datos reales)
- Los hijos de conexiones anidadas **no traen `id`** cuando el tipo no lo expone: las imágenes de galería llegan como `{image, __parentId}` y los niveles de inventario como `{location, quantities, updatedAt, __parentId}`. El `__parentId` de un InventoryLevel es el **gid de la variante**, no del inventoryItem.
- El status de producto puede ser **`UNLISTED`** (no solo ACTIVE/ARCHIVED/DRAFT). Enum ampliado en `drizzle/0001_add_unlisted_status.sql`.
- El parser (`bulk-parse.ts`) hace **dos pasadas** y no depende del orden de las líneas. Test: `pnpm tsx scripts/test-bulk-parse.ts`.

**Pendiente para "tiempo real" completo**: los webhooks no se pueden registrar contra `localhost`. Al desplegar a una URL pública, crear las suscripciones (`products/create|update|delete`, `inventory_levels/update`, `inventory_items/delete`) apuntando a `/api/webhooks/shopify` con `SHOPIFY_WEBHOOK_SECRET` = client secret.

## 3b. Notas históricas del token (ya no bloqueante)

La app está instalada en `caramba-juguetes.myshopify.com`. Tenemos client ID + secret (`.env.local`). **El client credentials grant NO funciona** (`shop_not_permitted`: la tienda no pertenece a la organización del Dev Dashboard donde se creó la app). Dos caminos, en orden de simpleza:

- **Camino A (si la app se creó en la tienda: Admin → Configuración → Aplicaciones → Desarrollo de aplicaciones):** ahí mismo está el "Admin API access token" (`shpat_…`) → pegarlo en `SHOPIFY_ADMIN_ACCESS_TOKEN` de `.env.local`. Listo.
- **Camino B (si es app del Dev Dashboard de otra organización):** en la config de la app agregar redirect URL `http://localhost:3002/api/auth/shopify/callback`, luego visitar `http://localhost:3002/api/auth/shopify/install` y aprobar. El callback guarda el token en DB (`sync_state`, clave `shopify_admin_token`) — las rutas OAuth ya están implementadas y el cliente lee env → DB en ese orden.

Scopes necesarios: `read_products, read_inventory, write_inventory`.

**Con token en mano:** (1) obtener el `SHOPIFY_LOCATION_ID` (query `locations(first:5)`), (2) correr full sync (botón en Ajustes o evento `sync/full.requested` — reemplaza el seed con datos+stock REALES), (3) crear las suscripciones de webhooks apuntando a `/api/webhooks/shopify` (topics en README), con `SHOPIFY_WEBHOOK_SECRET` = client secret (apps Dev Dashboard firman con él).

## 4. Gotchas descubiertos (no tropezar dos veces)

- **Inngest v4** (instalado 4.11): NO existe `EventSchemas`. Se usa `eventType("nombre", {schema: zod})` + `createFunction({id, retries, triggers: [evento, cron("...")]}, handler)` — 2 argumentos. Enviar: `inngest.send(evento.create({...}))`.
- **Drizzle en subqueries SQL crudas**: `${tabla.columna}` se renderiza SIN calificar en selects de una sola tabla → dentro de subqueries resuelve mal (error o datos silenciosamente incorrectos). Calificar a mano: `"products"."shopify_id"` (ya corregido en colaboradores y productos).
- **Pool de Postgres en dev**: cada recarga HMR de Turbopack creaba un pool nuevo → "too many clients". Resuelto cacheando el cliente en `globalThis` (`src/db/index.ts`). NO revertir.
- **`revalidatePath` después de crear pedido**: re-renderiza `/carrito` server-side, el redirect por cupo=0 le gana al `router.push` del cliente → nunca se ve `/listo`. Por eso `submitOrderAction` NO revalida (comentado en el código).
- **Layouts del App Router no se re-renderizan en navegación soft** → el badge de cupo del header queda stale tras un pedido; se resuelve con `router.refresh()` post-push (ya aplicado).
- **`orderCreate` de Shopify tiene `inventoryBehaviour: BYPASS` por default** — no lo usamos, pero si alguna vez se crean pedidos en Shopify, recordarlo.
- **Los zips del brandpack** tienen nombres CP437-mangled; extraer con Python re-encoding (ya extraído en `../branding/`).
- Los datos del seed vienen del `products.json` público de caramba.cl (2000 productos reales, imágenes CDN reales) pero **stock ficticio** (muchos `available:false` reales). El stock verdadero llega con el primer full sync.

## 5. Pendientes priorizados

**P0 — para salir a staging:**
1. Token Shopify (arriba) → full sync real → verificar espejo contra el admin de Shopify.
2. Registrar webhooks en la app (products/create|update|delete, inventory_levels/update, inventory_items/delete) y probar el ciclo: editar producto en Shopify → verlo cambiar en el espejo.
3. `SHOPIFY_LOCATION_ID` en env y verificación del ajuste de stock real al crear pedido (función `process-order-created`, hoy hace skip con warning si no hay token).
4. Deploy: Vercel (gru1) + Supabase (sa-east-1) + Inngest Cloud + Resend (dominio caramba.cl verificado). `.env.example` tiene todas las variables. Migración: `pnpm drizzle-kit migrate` con `DIRECT_DATABASE_URL`.

**P1 — antes de producción con cliente real:**
5. **RLS en Postgres** (multi-tenant): políticas por `company_id` con `current_setting('app.tenant_id')` + rol sin BYPASSRLS + tests de fuga (patrón en decision-arquitectura.md §2.5). Hoy el aislamiento es solo a nivel de queries.
6. Auth admin real: reemplazar password única por Supabase Auth (cuentas para Javiera + equipo), mantener `requireAdmin()` como interfaz.
7. Rate limiting HTTP en `identifyAction`/`verifyOtpAction` por IP (hoy solo hay rate limit por colaborador en OTP). Vercel Firewall o `@upstash/ratelimit`.
8. Anulación de pedido → reponer stock en Shopify (delta positivo, `reason: restock`) vía Inngest (TODO en `admin/pedidos/actions.ts`).
9. Página de detalle de producto en microsite (modal o ruta) con galería — hoy la card es todo.
10. Paginación del catálogo (hoy limit 60) e infinite scroll.

**P2 — calidad enterprise:**
11. Tests: unit para `catalog.ts` (filtros), `orders.ts` (carreras de cupo/stock — hay locks, testearlos), RUT; E2E Playwright del flujo colaborador.
12. Healthcheck de webhooks (silencio anómalo → recrear suscripción) + alertas (email a Ignacio).
13. Subida de logo de empresa a Supabase Storage (hoy es URL manual).
14. Métricas/estadísticas por campaña en el panel (gráfico de pedidos por día, top productos).
15. Borrado/anonimización de nóminas al cierre de campaña (Ley 21.719, vigencia 1-dic-2026) + DPA con empresas.

## 6. Convenciones

- Español en UI, comentarios y commits. Marca: "Caramba" (primera C mayúscula).
- Dinero CLP como enteros (`priceClp`). El colaborador JAMÁS ve precios (ni en HTML/JSON).
- Colores/tipografías SOLO del design system (`globals.css` @theme + `docs/brand-tokens.md`). Fondo blanco dominante, nunca fondo grafito.
- Componentes UI en `src/components/ui.tsx` — extender ahí, no crear sistemas paralelos.
- Todo efecto post-pedido va por Inngest (durable, retryable), nunca inline en la request.
