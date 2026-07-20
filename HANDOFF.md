# HANDOFF — Plataforma Caramba B2B

**Estado: EN PRODUCCIÓN.** Actualizado 20-jul-2026.

- **App**: https://b2bcaramba.vercel.app (alias: caramba-b2b.vercel.app), región `gru1` (São Paulo)
- **Panel**: /admin · cada usuario entra con **correo + contraseña** (sin depender de Resend); magic link como alternativa
- **Microsites**: /entel · /mercadolibre
- **Repo**: github.com/imc400/b2bcaramba
- **DB**: Supabase `ypmkejirsamzylxhwxdg` (sa-east-1)
- **Shopify**: app "Caramba B2B" en la org de Partners **Clicklab** (`dev.shopify.com/dashboard/128991664/apps/394980851713`)

## Verificar que todo está sano

```bash
pnpm test              # parser JSONL, campañas/DST, magic links, autorización de pedidos
pnpm verify:shopify    # E2E contra la tienda REAL: bodega, webhooks, CAS, espejo
pnpm verify:pedido --confirm   # pedido real → descuenta stock → anula → repone
pnpm verify:email tu@correo.cl # ¿salen los correos de verdad?
pnpm webhooks:list     # suscripciones activas
```

`verify:shopify` y `verify:pedido` mueven el stock y lo restauran: dejan la tienda exactamente como estaba.

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

**P0 — ÚNICO bloqueador para que OPEREN LOS COLABORADORES**
1. **Resend**: sin `RESEND_API_KEY` los correos (código de acceso del colaborador, avisos de pedido) solo se escriben en los logs. **Ningún colaborador puede entrar a su microsite** (su acceso es por código al correo). Guía: `../docs/setup-resend.md`.
   - El **panel admin ya NO depende de Resend**: Javiera y demás usuarios entran con correo + contraseña. Alta/reset de contraseña: `pnpm admin:password <correo> "<clave>"` (temporal por defecto; la persona la cambia al entrar en `/admin/cuenta`). También sirve de break-glass si un owner queda fuera.

**P0b — cuando haya cliente real**
2. **Dominio propio**: apuntar `app.caramba.cl` a Vercel (CNAME). El `redirect_url` ya está en `shopify.app.toml`; tras el cambio, correr `pnpm shopify:deploy` y `pnpm webhooks:register` con el nuevo `NEXT_PUBLIC_APP_URL`. **No tocar el DNS de caramba.cl** (está en Shopify).
3. **Quitar `ADMIN_PASSWORD`** de Vercel una vez que Resend funcione: el magic link la reemplaza y esa variable es el único acceso sin correo.

**P1 — escalabilidad y robustez**
4. **RLS en Postgres** (`company_id` + `current_setting('app.tenant_id')`) como defensa en profundidad del multi-tenant.
5. Paginación en `/admin/pedidos` (200 filas) y `/admin/colaboradores` (500) y en el catálogo del microsite (60).
6. Import de colaboradores: 2 queries por fila → batch + transacción.
7. Reconciliación: un step de Inngest por producto cambiado → agrupar.
8. Poda de `webhook_events`, `otp_codes`, `sessions`, `admin_magic_links`, `rate_limits` (crecen sin límite).
9. `/api/auth/shopify/install` sin gate de admin: cualquiera puede iniciar el OAuth.

**P2 — deuda de mantención** (ver hallazgos menores en el informe de revisión)
Estados de pedido duplicados en 3 componentes, "cupo usado" calculado en 3 lugares, `loadOrderBundle` reimplementado en el detalle, tokens de color hardcodeados.

## Acceso al panel

Acceso por **magic link**: se pide desde `/admin/login` con el correo y llega un enlace de 30 min, un solo uso. Las sesiones se guardan en `admin_sessions` y se pueden revocar de verdad.

- Primer usuario (una sola vez): `pnpm admin:crear javiera@caramba.cl "Javiera Fernández"` — imprime su enlace.
- Después, el propietario invita a su equipo desde `/admin/usuarios`.
- `ADMIN_PASSWORD` sigue existiendo como **acceso de emergencia** (entra como el propietario más antiguo). Quítala cuando Resend funcione.
- Los **colaboradores de las empresas NO tienen cuenta aquí**: se importan por Excel y entran a su microsite con un código de 6 dígitos.

## Comandos

```bash
pnpm dev --port 3002        # 3000/3001 ocupados por otros proyectos
pnpm seed                   # datos demo (NO usar contra producción)
pnpm sync                   # full-sync del catálogo (--cache reusa el JSONL)
pnpm admin:crear <correo> "<Nombre>"   # primer usuario del panel
pnpm admin:password <correo> "<clave>" # fija/resetea contraseña (temporal; --definitiva la deja final)
pnpm db:migrate             # con DIRECT_DATABASE_URL apuntando a la DB destino
pnpm migrate:supabase       # migra producción vía Management API (Vercel ya no
                            # deja leer sus variables sensibles, así que no
                            # tenemos la contraseña de la DB a mano)
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
- **Migraciones con `ALTER TYPE ... ADD VALUE`**: siempre con `IF NOT EXISTS`. Sin eso, la migración revienta en cualquier base donde el valor ya exista y **corta la cadena entera** (nos pasó: `rate_limits` no existía en local y nadie se dio cuenta).
- **`vercel env pull` devuelve vacías las variables sensibles.** Para operar contra la DB de producción usa `pnpm migrate:supabase` (Management API) o pide la contraseña.
