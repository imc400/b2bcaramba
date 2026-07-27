# Runbook de operación — Caramba B2B

Qué hacer cuando algo pasa. Verificado contra producción el 27-jul-2026.

---

## Monitoreo: cómo te enteras de que algo falla

La plataforma se **revisa sola cada 6 horas** (`/api/cron/health`) y **manda un correo solo cuando hay algo malo**. Es silenciosa a propósito: un correo diario que siempre dice "todo ok" se ignora, y entonces el que importa también.

Los avisos llegan a los **destinatarios globales** configurados en `/admin/ajustes` (los mismos que reciben los pedidos). **Si no hay ninguno, nadie recibe alertas** — asegúrate de tener al menos uno.

También puedes verlo en vivo, sin esperar el correo: **`/admin/ajustes` → "Estado de la plataforma"**.

### Qué vigila

| Chequeo | Se pone rojo cuando | Qué hacer |
|---|---|---|
| Reconciliación del catálogo | Sin correr hace >3 h (avisa a las 1.5 h) | Ver Cron Jobs en Vercel; que `CRON_SECRET` exista |
| Webhooks de Shopify | Sin eventos hace >24 h (avisa a las 6 h) | `pnpm webhooks:list`; que la app siga instalada |
| Pedidos que requieren atención | Hay pedidos con desajuste de stock o en "requiere revisión" | Abrirlos en `/admin/pedidos` y confirmar inventario en Shopify |
| Pedidos sin preparar | Alguno lleva >7 días en "por preparar" | Prepararlos o actualizar su estado |
| Configuración de producción | Falta `RESEND_API_KEY`, `CRON_SECRET`, el gate de stock no está en `true`, o `DEMO_MASTER_OTP` está definida | Corregir en Vercel (Production) y **volver a desplegar** |

---

## Backups de la base de datos

**Estado verificado (27-jul-2026):** Supabase hace **un backup automático diario** (~03:55 UTC ≈ 23:55 Chile) con **7 días de retención**. Los últimos 7 figuran como `COMPLETED`.

⚠️ **PITR (point-in-time recovery) está DESACTIVADO.** Consecuencia concreta: si a las 15:00 se corrompen o borran datos, lo más reciente a lo que puedes volver es el backup de las 03:55 → **se pierde lo del día** (pedidos, colaboradores importados, cambios de estado).

**Recomendación:** activar PITR en Supabase (add-on de pago) antes de operar campañas grandes. Con PITR puedes volver a cualquier segundo de los últimos días.

### Restaurar

1. Supabase → proyecto `caramba-b2b` → **Database → Backups**.
2. Elegir el backup y **Restore**. Sobrescribe la base actual: **avisa antes**, la plataforma queda inconsistente unos minutos.
3. Tras restaurar, correr `pnpm sync` para realinear el catálogo con Shopify (los pedidos NO se recuperan de Shopify: viven solo aquí — por eso importa el backup).

### Verificar backups sin entrar al dashboard

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/backups"
```

---

## Problemas frecuentes

### "El stock que muestra la plataforma no coincide con Shopify"

1. Mira `/admin/ajustes` → si "Reconciliación" está en rojo, ese es el motivo.
2. Arreglo inmediato: `pnpm sync` (full-resync del catálogo).
3. Causa de fondo: revisar el cron en Vercel y los webhooks (`pnpm webhooks:list`).

**Recuerda:** el espejo local **solo muestra**; la autoridad es Shopify. Un espejo desviado no produce sobreventa (Shopify rechaza con compare-and-swap), pero sí puede ofrecer algo que ya no está.

### "Un colaborador no recibe su código"

1. Confirma que su correo esté bien escrito en `/admin/colaboradores` — **ahora se puede editar** (ícono de lápiz).
2. Revisa el panel de Resend (rebotes/spam).
3. El acceso es solo por código al correo: sin correo válido no entra.

### "Un pedido quedó mal / hay que devolver el stock"

Cambia su estado a **Anulado** en `/admin/pedidos`. Eso **repone el stock en Shopify automáticamente** (verificado). Es irreversible: `anulado` es estado terminal.

### "Nadie puede entrar al panel"

`pnpm admin:password <correo> "<clave nueva>"` — fija contraseña y **cierra todas sus sesiones abiertas**. No depende del correo ni de Resend.

### "Hay que sacar a alguien del panel"

`/admin/usuarios` → Revocar. Cierra sus sesiones al instante. Siempre debe quedar al menos un propietario.

---

## Tareas periódicas

| Cuándo | Qué |
|---|---|
| Automático, cada hora | Reconciliación del catálogo (Vercel Cron) |
| Automático, domingo 05:00 UTC | Full-sync por Bulk Operations |
| Automático, cada 6 h | Chequeo de salud + alerta si hay problemas |
| Automático, diario 03:55 UTC | Backup de la base (Supabase) |
| A mano, cada varios meses | Podar `webhook_events` (crece ~1.500/día; 30k al 27-jul) |

### Podar el historial de webhooks

```sql
DELETE FROM webhook_events WHERE received_at < now() - interval '60 days';
```
Solo sirve para deduplicar entregas repetidas de Shopify; más allá de unos días no aporta.
