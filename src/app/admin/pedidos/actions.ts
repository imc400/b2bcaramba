"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { loadOrderBundle, notifyOrderShipped, restockOrder } from "@/lib/order-effects";
import { VALID_TRANSITIONS } from "@/lib/order-transitions";

export async function updateOrderStatusAction(orderId: string, newStatus: string): Promise<void> {
  const actor = await requireAdmin();

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error("Pedido no existe");
  if (!VALID_TRANSITIONS[order.status]?.includes(newStatus)) {
    throw new Error(`Transición inválida: ${order.status} → ${newStatus}`);
  }

  await db
    .update(orders)
    .set({
      status: newStatus as typeof order.status,
      updatedAt: new Date(),
      ...(newStatus !== "requiere_revision" ? { stockIssue: null } : {}),
    })
    .where(eq(orders.id, orderId));

  // Despacho: avisar al colaborador que su pedido va en camino. Tolerante a
  // fallos — un problema de correo no revierte el cambio de estado; el
  // resultado del envío queda registrado en el meta del historial.
  let correoDespacho: { enviado: boolean; destinatario?: string; motivo?: string } | undefined;
  if (newStatus === "despachado") {
    try {
      const bundle = await loadOrderBundle(orderId);
      const destinatario = await notifyOrderShipped(bundle);
      correoDespacho = destinatario
        ? { enviado: true, destinatario }
        : { enviado: false, motivo: "el colaborador no tiene correo registrado" };
    } catch (err) {
      console.error(`[order ${order.code}] correo de despacho falló:`, err);
      correoDespacho = { enviado: false, motivo: String(err).slice(0, 200) };
    }
  }

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "order_status_change",
    entity: "order",
    entityId: orderId,
    meta: {
      from: order.status,
      to: newStatus,
      code: order.code,
      ...(correoDespacho ? { correoDespacho } : {}),
    },
  });

  // Anulación: reponer el stock (espejo + Shopify). Tolerante a fallos —
  // el cambio de estado no se revierte si el restock remoto falla.
  if (newStatus === "anulado") {
    try {
      await restockOrder(orderId);
    } catch (err) {
      console.error(`[order ${order.code}] restock falló:`, err);
    }
  }

  revalidatePath("/admin/pedidos");
  // El selector vive también en la página de detalle: refrescarla para que
  // el estado y el historial queden coherentes al cambiar desde ahí.
  revalidatePath(`/admin/pedidos/${orderId}`);
}
