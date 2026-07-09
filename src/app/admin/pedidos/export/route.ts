import ExcelJS from "exceljs";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, collaborators, companies, orderItems, orders } from "@/db/schema";
import { isAdminAuthenticated } from "@/lib/auth/admin";

/** Exporta todos los pedidos a Excel (una fila por ítem, para bodega). */
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return new Response("No autorizado", { status: 401 });
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
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pedidos-caramba-${today}.xlsx"`,
    },
  });
}
