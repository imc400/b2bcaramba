import ExcelJS from "exceljs";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { campaigns, collaborators, companies, orderItems, orders } from "@/db/schema";
import { isAdminAuthenticated } from "@/lib/auth/admin";

/** Trozo seguro para el nombre del archivo (la búsqueda puede traer tildes o espacios). */
function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * Exporta pedidos a Excel (una fila por ítem, para bodega) respetando los
 * mismos filtros de la página de pedidos: empresa, estado y búsqueda `q`.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return new Response("No autorizado", { status: 401 });
  }

  // Misma semántica de filtrado que src/app/admin/pedidos/page.tsx.
  const { searchParams } = request.nextUrl;
  const empresa = searchParams.get("empresa") ?? undefined;
  const estado = searchParams.get("estado") ?? undefined;
  const q = searchParams.get("q") ?? undefined;

  const conditions: SQL[] = [];
  if (empresa) conditions.push(eq(companies.slug, empresa));
  if (estado) conditions.push(sql`${orders.status} = ${estado}`);
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    conditions.push(
      sql`(${orders.code} ILIKE ${like} OR ${orders.recipientName} ILIKE ${like} OR ${collaborators.name} ILIKE ${like} OR ${orders.comuna} ILIKE ${like})`,
    );
  }

  const rows = await db
    .select({
      code: orders.code,
      status: orders.status,
      createdAt: orders.createdAt,
      companyName: companies.name,
      campaignName: campaigns.name,
      collaboratorName: collaborators.name,
      collaboratorEmail: collaborators.email,
      recipientName: orders.recipientName,
      phone: orders.phone,
      addressLine: orders.addressLine,
      comuna: orders.comuna,
      addressNotes: orders.addressNotes,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      priceClp: orderItems.priceClp,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(companies, eq(orders.companyId, companies.id))
    .innerJoin(campaigns, eq(orders.campaignId, campaigns.id))
    .innerJoin(collaborators, eq(orders.collaboratorId, collaborators.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pedidos");

  sheet.columns = [
    { header: "Pedido", key: "code", width: 16 },
    { header: "Estado", key: "status", width: 16 },
    { header: "Fecha", key: "createdAt", width: 14 },
    { header: "Empresa", key: "companyName", width: 18 },
    { header: "Campaña", key: "campaignName", width: 18 },
    { header: "Colaborador", key: "collaboratorName", width: 22 },
    { header: "Correo", key: "collaboratorEmail", width: 26 },
    { header: "Recibe", key: "recipientName", width: 22 },
    { header: "Teléfono", key: "phone", width: 16 },
    { header: "Dirección", key: "addressLine", width: 32 },
    { header: "Comuna", key: "comuna", width: 16 },
    { header: "Indicaciones", key: "addressNotes", width: 24 },
    { header: "Producto", key: "productTitle", width: 40 },
    { header: "Variante", key: "variantTitle", width: 16 },
    { header: "Cantidad", key: "quantity", width: 10 },
    { header: "Precio ref. (CLP)", key: "priceClp", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    sheet.addRow({
      ...r,
      createdAt: r.createdAt.toLocaleDateString("es-CL"),
      variantTitle: r.variantTitle === "Default Title" ? "" : r.variantTitle,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);
  // Nombre descriptivo: fecha + sufijo con los filtros aplicados (si los hay),
  // p. ej. pedidos-caramba-2026-08-18-entel-despachado.xlsx
  const sufijo = [empresa, estado, q?.trim()]
    .filter((v): v is string => Boolean(v))
    .map(slugify)
    .filter(Boolean)
    .join("-");
  const filename = `pedidos-caramba-${today}${sufijo ? `-${sufijo}` : ""}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
