# HANDOFF — Plataforma Caramba B2B

**Estado: EN PRODUCCIÓN.** Actualizado 09-jul-2026.

- **App**: https://b2bcaramba.vercel.app (alias: caramba-b2b.vercel.app), región `gru1` (São Paulo)
- **Panel**: /admin · password en `ADMIN_PASSWORD`
- **Microsites**: /entel · /mercadolibre
- **Repo**: github.com/imc400/b2bcaramba
- **DB**: Supabase `ypmkejirsamzylxhwxdg` (sa-east-1)
- **Shopify**: app "Caramba B2B" en la org de Partners **Clicklab** (`dev.shopify.com/dashboard/128991664/apps/394980851713`)

## Verificar que todo está sano

```bash
pnpm test            # parser JSONL, campañas/DST, autorización de pedidos
pnpm verify:shopify  # E2E contra la tienda REAL: bodega, webhooks, CAS, espejo
pnpm webhooks:list   # suscripciones activas
```

`verify:shopify` cambia el stock de un producto +1 y lo restaura: deja la tienda exactamente como estaba.

## Reglas que no se pueden romper

1. **Una sola bodega.** La tienda tiene 5 locations; solo **La Forja 8600 (`35186606180`)** despacha online. Toda lectura/escritura de stock pasa por `getFulfillmentLocationId()` (`src/lib/shopify/location.ts`). Sin ese filtro, el catálogo ofrece unidades que están en la vitrina de Los Trapenses.
2. **El colaborador nunca ve precios.** Ni en UI, ni en HTML, ni en respuestas de server actions.
3. **`createOrder` es la autoridad de autorización.** Valida que cada variante esté en el catálogo de SU campaña (`getOrderableVariantIds`). Nunca confiar en los `variantIds` del cliente.
4. **`DEMO_MASTER_OTP` jamás en producción.** Tiene gate por `NODE_ENV`, pero no la definas igual.
5. **El espejo local muestra; Shopify comprometa.** El descuento real ocurre en Shopify con compare-and-swap.

## Shopify: lo que aprendimos con datos reales (API 2026-07)

- **`inventoryAdjustQuantities` exige `changeFromQuantity`** (compare-and-swap) **y la directiva `@idempotent(key:)`** (obligatoria desde 2026-04). Sin ambas, la mutación falla. El CAS es la garantía de exactamente-una-vez: si el stock cambió, Shopify **rechaza la mutación completa sin escribir nada**. `applyInventoryDelta` (`src/lib/order-effects.ts`) usa eso para distinguir "mi escritura ya llegó" de "una venta B2C se llevó unidades".
- **`quantityAfterChange` puede venir `null`.** Nunca uses `?? 0` para detectar oversell: relee la cantidad con `getInventoryQuantities`.
- **El JSONL de Bulk Operations**: los hijos de conexiones anidadas **no traen `id`**. Las imágenes de galería llegan como `{image, __parentId}` y los niveles de inventario como `{location, quantities, __parentId}`, donde `__parentId` es el **gid de la variante**. El parser hace dos pasadas y no depende del orden.
- **`status` de producto puede ser `UNLISTED`**, no solo ACTIVE/ARCHIVED/DRAFT.
- **Los webhooks declarados en `shopify.app.toml` no se materializaron.** Se registran con `pnpm webhooks:register` (idempotente, vía Admin API). Verificado: llegan en ~4 segundos.
- **`client_credentials` no sirve**: la tienda no pertenece a la org de la app (`shop_not_permitted`). Se usa el OAuth de `/api/auth/shopify/install`. Shopify exige que `redirect_urls` compartan host con `application_url`.

## Arquitectura del espejo (3 capas)

| Capa | Mecanismo | Cuándo |
|---|---|---|
| Tiempo real | 7 webhooks → `/api/webhooks/shopify` | ~4s |
| Reparación | reconciliación incremental por `updated_at` (repara stock también) | cada hora |
| Red de seguridad | `pnpm sync` / full-sync por Bulk Operations | semanal o a mano |

Los webhooks corren por Inngest si `INNGEST_EVENT_KEY` está definida; si no, **inline** (mismo código, `src/lib/shopify/webhook-processor.ts`). Igual con los efectos de pedido (`src/lib/order-effects.ts`).

## Pendientes priorizados

**P0 — antes del primer cliente real**
1. **Resend**: crear cuenta, verificar dominio caramba.cl, poner `RESEND_API_KEY`. Hoy los correos (OTP y avisos de pedido) solo se loguean.
2. **Dominio propio**: apuntar `app.caramba.cl` a Vercel (CNAME). El `redirect_url` ya está en `shopify.app.toml`; tras el cambio, correr `pnpm shopify:deploy` y `pnpm webhooks:register` con el nuevo `NEXT_PUBLIC_APP_URL`. **No tocar el DNS de caramba.cl** (está en Shopify).
3. **Auth admin real**: hoy es una password compartida (con rate limit por IP). Migrar a Supabase Auth con cuentas por persona.

**P1 — escalabilidad y robustez**
4. **RLS en Postgres** (`company_id` + `current_setting('app.tenant_id')`) como defensa en profundidad del multi-tenant.
5. Paginación en `/admin/pedidos` (200 filas) y `/admin/colaboradores` (500) y en el catálogo del microsite (60).
6. Import de colaboradores: 2 queries por fila → batch + transacción.
7. Reconciliación: un step de Inngest por producto cambiado → agrupar.
8. Poda de `webhook_events`, `otp_codes`, `sessions`, `rate_limits` (crecen sin límite).
9. Escapar HTML en los correos internos (nombre/dirección del colaborador se interpolan).
10. `/api/auth/shopify/install` sin gate de admin: cualquiera puede iniciar el OAuth.

**P2 — deuda de mantención** (ver hallazgos menores en el informe de revisión)
Estados de pedido duplicados en 3 componentes, "cupo usado" calculado en 3 lugares, `loadOrderBundle` reimplementado en el detalle, tokens de color hardcodeados.

## Comandos

```bash
pnpm dev --port 3002        # 3000/3001 ocupados por otros proyectos
pnpm seed                   # datos demo (NO usar contra producción)
pnpm sync                   # full-sync del catálogo (--cache reusa el JSONL)
pnpm db:migrate             # con DIRECT_DATABASE_URL apuntando a la DB destino
pnpm shopify:deploy         # publica shopify.app.toml
vercel deploy --prod --yes
```

## Gotchas del stack

- **Inngest v4**: `createFunction({triggers: [evento, cron("...")]}, handler)` — 2 args. No existe `EventSchemas`. Los `step.run` serializan Dates a strings: recarga el bundle dentro de cada paso.
- **Drizzle**: en subqueries SQL crudas, `${tabla.columna}` no se califica → escribe `"products"."shopify_id"` a mano. Y si dos tablas tienen una columna con el mismo nombre (`products.shopify_id` y `variants.shopify_id`), la subquery necesita alias explícito.
- **`server-only`** rompe los scripts: usa `pnpm tsx --tsconfig tsconfig.scripts.json` (stub en `scripts/stubs/`).
- **Pool de Postgres en dev**: el cliente se cachea en `globalThis` (HMR crearía un pool por recarga). No revertir.
- **`revalidatePath` tras crear un pedido** re-renderiza `/carrito`, cuyo redirect por cupo=0 le gana al `router.push` hacia `/listo`. Por eso no se revalida ahí.
- **Turbopack**: si tras reiniciar aparece `Cannot find module 'drizzle-orm'`, es caché corrupta → `rm -rf .next`.
