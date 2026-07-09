"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { restockOrder } from "@/lib/order-effects";

const VALID_TRANSITIONS: Record<string, string[]> = {
  por_preparar: ["preparando", "despachado", "anulado"],
  preparando: ["despachado", "anulado", "por_preparar"],
  despachado: ["preparando"],
  requiere_revision: ["por_preparar", "anulado"],
  anulado: [],
};

export async function updateOrderStatusAction(orderId: string, newStatus: string): Promise<void> {
  await requireAdmin();

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

  await db.insert(auditLog).values({
    actorEmail: "admin",
    action: "order_status_change",
    entity: "order",
    entityId: orderId,
    meta: { from: order.status, to: newStatus, code: order.code },
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
}
