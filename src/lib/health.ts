import "server-only";
import { and, count, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, syncState, webhookEvents } from "@/db/schema";

/**
 * Chequeo de salud de la plataforma. Existe porque hasta ahora NADIE se
 * enteraba si el espejo dejaba de repararse, los webhooks se cortaban o un
 * pedido quedaba trabado: había que ir a mirar la base a mano.
 *
 * Cada chequeo es independiente y no puede tumbar al resto (si uno falla, se
 * reporta como "error" y los demás siguen). Lo consume el cron de alertas y la
 * página de Ajustes.
 */

export type Severidad = "ok" | "aviso" | "critico";

export type Chequeo = {
  id: string;
  titulo: string;
  severidad: Severidad;
  detalle: string;
  /** Qué hacer si está en rojo (va en el correo de alerta) */
  accion?: string;
};

export type ReporteSalud = {
  generadoEn: string;
  severidad: Severidad;
  chequeos: Chequeo[];
};

// La reconciliación corre cada hora; damos margen para reintentos y colas.
const RECONCILE_AVISO_MIN = 90;
const RECONCILE_CRITICO_MIN = 180;
// La tienda recibe ~1.500 webhooks/día, pero de madrugada baja mucho.
const WEBHOOK_AVISO_HORAS = 6;
const WEBHOOK_CRITICO_HORAS = 24;
// Un pedido no debería quedar "por preparar" más de una semana.
const PEDIDO_ESTANCADO_DIAS = 7;

function peor(a: Severidad, b: Severidad): Severidad {
  const orden: Severidad[] = ["ok", "aviso", "critico"];
  return orden.indexOf(a) >= orden.indexOf(b) ? a : b;
}

async function seguro(id: string, titulo: string, fn: () => Promise<Chequeo>): Promise<Chequeo> {
  try {
    return await fn();
  } catch (err) {
    return {
      id,
      titulo,
      severidad: "critico",
      detalle: `El chequeo falló: ${String(err).slice(0, 160)}`,
      accion: "Revisa los logs de la aplicación y que la base responda.",
    };
  }
}

/** Capa 2 del espejo: si se atrasa, el stock mostrado empieza a derivar. */
async function chequearReconciliacion(): Promise<Chequeo> {
  const fila = await db.query.syncState.findFirst({
    where: eq(syncState.key, "reconciliation_checkpoint"),
  });
  const iso = (fila?.value as { iso?: string } | undefined)?.iso;
  if (!iso) {
    return {
      id: "reconciliacion",
      titulo: "Reconciliación del catálogo",
      severidad: "critico",
      detalle: "Nunca ha corrido: no hay checkpoint guardado.",
      accion: "Revisa que el cron /api/cron/reconcile esté activo en Vercel (Settings → Cron Jobs).",
    };
  }
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const severidad: Severidad =
    minutos >= RECONCILE_CRITICO_MIN ? "critico" : minutos >= RECONCILE_AVISO_MIN ? "aviso" : "ok";
  return {
    id: "reconciliacion",
    titulo: "Reconciliación del catálogo",
    severidad,
    detalle:
      severidad === "ok"
        ? `Última corrida hace ${minutos} min.`
        : `Sin correr hace ${minutos} min (debería ser cada hora).`,
    accion: "Verifica el cron /api/cron/reconcile en Vercel y que CRON_SECRET esté definido.",
  };
}

/** Capa 1: los webhooks son el tiempo real del espejo. */
async function chequearWebhooks(): Promise<Chequeo> {
  const [fila] = await db
    .select({ ultimo: sql<string | null>`max(${webhookEvents.receivedAt})` })
    .from(webhookEvents);
  if (!fila?.ultimo) {
    return {
      id: "webhooks",
      titulo: "Webhooks de Shopify",
      severidad: "critico",
      detalle: "No hay ningún webhook registrado.",
      accion: "Corre `pnpm webhooks:register` y revisa SHOPIFY_WEBHOOK_SECRET.",
    };
  }
  const horas = (Date.now() - new Date(fila.ultimo).getTime()) / 3_600_000;
  const severidad: Severidad =
    horas >= WEBHOOK_CRITICO_HORAS ? "critico" : horas >= WEBHOOK_AVISO_HORAS ? "aviso" : "ok";

  const [{ ultimas24h }] = await db
    .select({ ultimas24h: count() })
    .from(webhookEvents)
    .where(gt(webhookEvents.receivedAt, new Date(Date.now() - 24 * 3_600_000)));

  return {
    id: "webhooks",
    titulo: "Webhooks de Shopify",
    severidad,
    detalle:
      severidad === "ok"
        ? `${ultimas24h} eventos en 24h; el último hace ${Math.round(horas * 60)} min.`
        : `Sin eventos hace ${horas.toFixed(1)} h (${ultimas24h} en las últimas 24h).`,
    accion: "Revisa `pnpm webhooks:list` y que la app siga instalada en Shopify.",
  };
}

/** Un pedido con stock_issue quedó desalineado con Shopify: revisar a mano. */
async function chequearPedidosConProblema(): Promise<Chequeo> {
  const [{ conIssue }] = await db
    .select({ conIssue: count() })
    .from(orders)
    .where(and(isNotNull(orders.stockIssue), sql`${orders.status} <> 'anulado'`));
  const [{ enRevision }] = await db
    .select({ enRevision: count() })
    .from(orders)
    .where(eq(orders.status, "requiere_revision"));

  const total = Number(conIssue) + Number(enRevision);
  return {
    id: "pedidos_problema",
    titulo: "Pedidos que requieren atención",
    severidad: total > 0 ? "critico" : "ok",
    detalle:
      total === 0
        ? "Ningún pedido con problemas de stock ni en revisión."
        : `${conIssue} con desajuste de stock y ${enRevision} marcados "requiere revisión".`,
    accion: "Ábrelos en /admin/pedidos y confirma el inventario en Shopify antes de despachar.",
  };
}

/** Pedidos que llevan demasiado sin prepararse: el colaborador está esperando. */
async function chequearPedidosEstancados(): Promise<Chequeo> {
  const limite = new Date(Date.now() - PEDIDO_ESTANCADO_DIAS * 24 * 3_600_000);
  const filas = await db
    .select({ code: orders.code, createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.status, "por_preparar"), lt(orders.createdAt, limite)))
    .orderBy(desc(orders.createdAt))
    .limit(5);

  return {
    id: "pedidos_estancados",
    titulo: "Pedidos sin preparar",
    severidad: filas.length > 0 ? "aviso" : "ok",
    detalle:
      filas.length === 0
        ? `Ninguno lleva más de ${PEDIDO_ESTANCADO_DIAS} días esperando.`
        : `${filas.length} pedido(s) llevan más de ${PEDIDO_ESTANCADO_DIAS} días en "por preparar": ${filas.map((f) => f.code).join(", ")}.`,
    accion: "Prepáralos o actualiza su estado en /admin/pedidos.",
  };
}

/** El gate que decide si los pedidos descuentan stock real en Shopify. */
async function chequearConfiguracion(): Promise<Chequeo> {
  const faltantes: string[] = [];
  if (process.env.SHOPIFY_STOCK_ADJUST_ENABLED !== "true") faltantes.push("SHOPIFY_STOCK_ADJUST_ENABLED != 'true'");
  if (!process.env.RESEND_API_KEY) faltantes.push("RESEND_API_KEY ausente (no salen correos)");
  if (!process.env.CRON_SECRET) faltantes.push("CRON_SECRET ausente (los crons no corren)");
  if (process.env.DEMO_MASTER_OTP) faltantes.push("DEMO_MASTER_OTP definida (código maestro de demo)");

  return {
    id: "configuracion",
    titulo: "Configuración de producción",
    severidad: faltantes.length > 0 ? "critico" : "ok",
    detalle: faltantes.length === 0 ? "Todas las variables críticas están correctas." : faltantes.join(" · "),
    accion: "Corrige las variables en Vercel (Production) y vuelve a desplegar.",
  };
}

export async function generarReporteSalud(): Promise<ReporteSalud> {
  const chequeos = await Promise.all([
    seguro("reconciliacion", "Reconciliación del catálogo", chequearReconciliacion),
    seguro("webhooks", "Webhooks de Shopify", chequearWebhooks),
    seguro("pedidos_problema", "Pedidos que requieren atención", chequearPedidosConProblema),
    seguro("pedidos_estancados", "Pedidos sin preparar", chequearPedidosEstancados),
    seguro("configuracion", "Configuración de producción", chequearConfiguracion),
  ]);

  return {
    generadoEn: new Date().toISOString(),
    severidad: chequeos.reduce<Severidad>((acc, c) => peor(acc, c.severidad), "ok"),
    chequeos,
  };
}
