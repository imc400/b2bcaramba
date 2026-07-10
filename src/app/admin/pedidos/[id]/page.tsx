import { and, desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  Building2,
  Mail,
  MapPin,
  Phone,
  TriangleAlert,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  auditLog,
  campaigns,
  collaborators,
  companies,
  orderItems,
  orders,
} from "@/db/schema";
import { AdminShell } from "@/components/admin-shell";
import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { formatRut } from "@/lib/auth/rut";
import { StatusSelect } from "../status-select";

export default async function PedidoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;

  const [row] = await db
    .select({
      order: orders,
      company: companies,
      campaign: campaigns,
      collaborator: collaborators,
    })
    .from(orders)
    .innerJoin(companies, eq(orders.companyId, companies.id))
    .innerJoin(campaigns, eq(orders.campaignId, campaigns.id))
    .innerJoin(collaborators, eq(orders.collaboratorId, collaborators.id))
    .where(eq(orders.id, id));

  if (!row) notFound();
  const { order, company, campaign, collaborator } = row;

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const totalClp = items.reduce((s, i) => s + i.priceClp * i.quantity, 0);

  const history = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, "order"), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.createdAt))
    .limit(20);

  return (
    <AdminShell
      active="/admin/pedidos"
      usuario={actor}
      title={`Pedidos › ${order.code}`}
      actions={<StatusSelect orderId={order.id} current={order.status} />}
    >
      <Link
        href="/admin/pedidos"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-caramba-grafito/55 hover:text-caramba-grafito"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        Volver a pedidos
      </Link>

      {order.stockIssue ? (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-caramba-rojo-soft px-5 py-4 text-sm text-[#a34433]">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
          <div>
            <p className="font-semibold">Este pedido requiere revisión de stock</p>
            <p className="mt-0.5 opacity-80">
              Al descontar en Shopify, el ítem {order.stockIssue.variantId} quedó en{" "}
              {order.stockIssue.resultingQuantity} unidades (carrera con la venta web). Verifica
              disponibilidad física antes de preparar.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Ítems */}
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="border-b border-caramba-grafito/8 px-6 py-4">
              <h2 className="font-display text-base text-caramba-grafito">
                Regalos elegidos ({items.length})
              </h2>
            </div>
            <ul>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-4 border-b border-caramba-grafito/5 px-6 py-4 last:border-0"
                >
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-caramba-crema">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt=""
                        fill
                        sizes="64px"
                        className="object-contain p-1.5"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-caramba-grafito">{item.productTitle}</p>
                    <p className="text-xs text-caramba-grafito/50">
                      {item.variantTitle && item.variantTitle !== "Default Title"
                        ? `${item.variantTitle} · `
                        : ""}
                      SKU interno {item.variantShopifyId}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-caramba-grafito">
                      ${item.priceClp.toLocaleString("es-CL")}
                    </p>
                    <p className="text-xs text-caramba-grafito/50">×{item.quantity}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between bg-caramba-crema px-6 py-3.5">
              <p className="text-sm font-semibold text-caramba-grafito/60">
                Valor total (interno — el colaborador no lo ve)
              </p>
              <p className="font-display text-lg text-caramba-grafito">
                ${totalClp.toLocaleString("es-CL")}
              </p>
            </div>
          </Card>

          {/* Historial */}
          <Card className="p-6">
            <h2 className="font-display text-base text-caramba-grafito">Historial</h2>
            <ul className="mt-4 space-y-3">
              <li className="flex items-baseline gap-3 text-sm">
                <span className="shrink-0 text-xs text-caramba-grafito/45">
                  {order.createdAt.toLocaleString("es-CL", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-caramba-grafito/75">
                  Pedido creado por el colaborador desde el link de {company.name}
                </span>
              </li>
              {history.map((h) => (
                <li key={h.id} className="flex items-baseline gap-3 text-sm">
                  <span className="shrink-0 text-xs text-caramba-grafito/45">
                    {h.createdAt.toLocaleString("es-CL", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-caramba-grafito/75">
                    {h.action === "order_status_change"
                      ? `Estado: ${label((h.meta as { from?: string })?.from)} → ${label((h.meta as { to?: string })?.to)}`
                      : h.action}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Cliente final */}
        <div className="space-y-4">
          <Card className="space-y-4 p-6">
            <h2 className="font-display text-base text-caramba-grafito">Despacho</h2>
            <InfoRow icon={User} label="Recibe" value={order.recipientName} />
            <InfoRow icon={Phone} label="Teléfono" value={order.phone} href={`tel:${order.phone}`} />
            <InfoRow
              icon={MapPin}
              label="Dirección"
              value={`${order.addressLine}, ${order.comuna}${order.region ? `, ${order.region}` : ""}`}
            />
            {order.addressNotes ? (
              <div className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-[13px] text-[#8a6d1a]">
                {order.addressNotes}
              </div>
            ) : null}
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="font-display text-base text-caramba-grafito">Colaborador</h2>
            <InfoRow icon={User} label="Nombre" value={collaborator.name ?? "—"} />
            {collaborator.email ? (
              <InfoRow
                icon={Mail}
                label="Correo"
                value={collaborator.email}
                href={`mailto:${collaborator.email}`}
              />
            ) : null}
            {collaborator.rut ? (
              <InfoRow icon={User} label="RUT" value={formatRut(collaborator.rut)} />
            ) : null}
            <InfoRow icon={Building2} label="Empresa" value={`${company.name} · ${campaign.name}`} />
            <div className="pt-1">
              <Badge tone="neutro">
                Cupo {collaborator.quota} regalo{collaborator.quota === 1 ? "" : "s"}
              </Badge>
            </div>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}

function label(status?: string): string {
  const map: Record<string, string> = {
    por_preparar: "Por preparar",
    preparando: "Preparando",
    despachado: "Despachado",
    anulado: "Anulado",
    requiere_revision: "Requiere revisión",
  };
  return status ? (map[status] ?? status) : "—";
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof User;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-caramba-verde" strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/45">
          {label}
        </p>
        <p className="break-words text-sm font-medium text-caramba-grafito">{value}</p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block hover:opacity-70">
      {content}
    </a>
  ) : (
    content
  );
}
