# Caramba B2B — Plataforma de regalos corporativos

Plataforma multi-empresa que convierte cada empresa cliente en una tienda Caramba: un link co-branded por empresa (`app.caramba.cl/entel`), autoservicio para cada colaborador (catálogo sin precios, cupos por persona) y pedidos listos para despachar desde el panel.

**Documentos de referencia** (en la carpeta padre del repo):
- `docs/decision-arquitectura.md` — arquitectura, veredicto MCP, riesgos, decisiones.
- `docs/brand-tokens.md` — design system extraído del Brandbook oficial.
- `Propuesta Caramba B2B.pdf` — alcance comprometido con el cliente.

## Arquitectura (resumen)

```
SAP ──▶ Shopify (fuente de verdad) ──▶ Espejo local (Postgres/Supabase)
              │                              │
              │ webhooks + bulk + reconcile  │ lee microsites + panel
              │ (Inngest, idempotente)       │
              ◀── inventoryAdjustQuantities ── pedido confirmado
```

- **Espejo de catálogo/stock**: 3 capas — Bulk Operations (inicial + semanal), webhooks (`products/*`, `inventory_levels/update`, dedup por `X-Shopify-Webhook-Id`), reconciliación horaria por `updated_at`.
- **Pedidos**: viven en esta plataforma (no en Shopify). Al confirmar: transacción en Postgres (cupo + stock) → `inventoryAdjustQuantities` en Shopify (el stock baja al instante, la venta B2C no se pisa) → notificación por correo a destinatarios configurables.
- **Acceso colaboradores**: correo/RUT como identificador + OTP de 6 dígitos al correo corporativo. Anti-enumeración (respuesta idéntica, rate limiting). Sesiones opacas en cookie HttpOnly.
- **Stock de seguridad**: no se muestran productos con stock ≤ umbral (default 1, por campaña).

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) |
| DB | Supabase Postgres (sa-east-1) + Drizzle ORM |
| Jobs/colas | Inngest (webhooks durables, crons de reconciliación) |
| Email | Resend (OTP + notificaciones de pedidos) |
| Hosting | Vercel (gru1 — São Paulo) |
| Imágenes | CDN de Shopify directo (`cdn.shopify.com`) |

## Desarrollo

```bash
pnpm install
cp .env.example .env.local   # completar credenciales
pnpm drizzle-kit push         # crear schema en la DB (dev)
pnpm dev                      # app en http://localhost:3000
npx inngest-cli@latest dev    # Inngest dev server (otro terminal)
```

### Credenciales necesarias

1. **Shopify custom app** (Dev Dashboard de caramba.cl): scopes `read_products`, `read_inventory`, `write_inventory`. API version `2026-07`.
2. **Webhooks** apuntando a `/api/webhooks/shopify`: `products/create`, `products/update`, `products/delete`, `inventory_levels/update`, `inventory_items/delete`.
3. **Supabase** proyecto en `sa-east-1`; usar pooler (6543) en `DATABASE_URL` y conexión directa (5432) en `DIRECT_DATABASE_URL`.
4. **Resend** con dominio verificado de caramba.cl.
5. **Inngest** app keys.

## Estructura

```
src/
  app/
    api/webhooks/shopify/   # receptor HMAC + dedup + encolar (contrato <5s)
    api/inngest/            # serve de funciones Inngest
    (microsite)/[slug]/     # tienda del colaborador por empresa  [pendiente]
    admin/                  # panel Caramba (Javiera)              [pendiente]
  db/                       # schema Drizzle + cliente
  inngest/functions/        # process-webhook, reconcile, full-sync
  lib/shopify/              # cliente Admin GraphQL, operaciones, HMAC
  fonts/                    # Capriola + Spartan (Brandbook)
public/brand/               # logos SVG + iconografía oficial
```

## Principios no negociables

1. El webhook receiver responde 200 en <5s — todo procesamiento va a Inngest (8 fallos ⇒ Shopify elimina la suscripción).
2. Upserts idempotentes; eventos fuera de orden se descartan por `shopifyUpdatedAt`.
3. El espejo local es para *mostrar*; Shopify es la autoridad para *comprometer* stock.
4. Multi-tenant: toda tabla con datos de empresa lleva `company_id`; RLS se activa en la migración de Supabase (rol app sin BYPASSRLS).
5. El colaborador nunca ve precios — ni en UI, ni en el HTML, ni en respuestas de API del microsite.
