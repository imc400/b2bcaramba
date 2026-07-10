"use server";

import ExcelJS from "exceljs";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, campaigns, collaborators, companies } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { isValidRut, normalizeRut } from "@/lib/auth/rut";
import { isCampaignOpen } from "@/lib/campaign";
import { collaboratorInviteHtml, sendEmail } from "@/lib/email/send";

export type ImportResult = {
  status: "idle" | "ok" | "error";
  message?: string;
  imported?: number;
  updated?: number;
  skipped?: { row: number; reason: string }[];
};

/**
 * Importa colaboradores desde Excel (.xlsx) o CSV.
 * Detección flexible de columnas: correo/email, rut, nombre/name, cupo/quota.
 * Upsert por correo o RUT dentro de la campaña (re-importar actualiza cupos).
 */
export async function importCollaboratorsAction(
  _prev: ImportResult,
  formData: FormData,
): Promise<ImportResult> {
  const actor = await requireAdmin();

  const campaignId = String(formData.get("campaignId") ?? "");
  const file = formData.get("file") as File | null;
  if (!campaignId || !file || file.size === 0) {
    return { status: "error", message: "Selecciona una campaña y un archivo." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { status: "error", message: "Archivo muy grande (máx 5 MB)." };
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { status: "error", message: "Campaña no existe." };

  // --- Parsear filas -------------------------------------------------------
  let rows: string[][];
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      rows = text
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => l.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, "")));
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      rows = [];
      sheet.eachRow((row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          values.push(String(cell.value ?? "").trim());
        });
        rows.push(values);
      });
    }
  } catch {
    return { status: "error", message: "No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?" };
  }

  if (rows.length < 2) {
    return { status: "error", message: "El archivo no tiene filas de datos." };
  }

  // --- Detectar columnas ---------------------------------------------------
  const header = rows[0].map((h) => h.toLowerCase());
  const colEmail = header.findIndex((h) => /correo|email|mail/.test(h));
  const colRut = header.findIndex((h) => /rut/.test(h));
  const colName = header.findIndex((h) => /nombre|name/.test(h));
  const colQuota = header.findIndex((h) => /cupo|quota|regalos/.test(h));

  if (colEmail === -1 && colRut === -1) {
    return {
      status: "error",
      message: `No encontré columna de correo ni RUT. Columnas detectadas: ${rows[0].join(", ")}`,
    };
  }

  // --- Upsert por fila -----------------------------------------------------
  let imported = 0;
  let updated = 0;
  const skipped: { row: number; reason: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const rawEmail = colEmail >= 0 ? cells[colEmail]?.toLowerCase().trim() : "";
    const rawRut = colRut >= 0 ? cells[colRut] : "";
    const name = colName >= 0 ? cells[colName] : null;
    const quotaRaw = colQuota >= 0 ? Number(cells[colQuota]) : NaN;
    const quota = Number.isFinite(quotaRaw) && quotaRaw >= 1 ? Math.min(quotaRaw, 10) : campaign.defaultQuota;

    const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
    const rut = rawRut ? normalizeRut(rawRut) : null;

    if (!email && !rut) {
      skipped.push({ row: i + 1, reason: "sin correo ni RUT válido" });
      continue;
    }
    if (rut && !isValidRut(rawRut)) {
      skipped.push({ row: i + 1, reason: `RUT inválido: ${rawRut}` });
      continue;
    }

    const existing = await db
      .select()
      .from(collaborators)
      .where(
        and(
          eq(collaborators.campaignId, campaignId),
          email ? eq(collaborators.email, email) : eq(collaborators.rut, rut!),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(collaborators)
        .set({ name: name || existing[0].name, quota, rut: rut ?? existing[0].rut })
        .where(eq(collaborators.id, existing[0].id));
      updated++;
    } else {
      await db.insert(collaborators).values({
        companyId: campaign.companyId,
        campaignId,
        email,
        rut,
        name,
        quota,
      });
      imported++;
    }
  }

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "collaborators_import",
    entity: "campaign",
    entityId: campaignId,
    meta: { file: file.name, imported, updated, skipped: skipped.length },
  });

  revalidatePath("/admin/colaboradores");
  return {
    status: "ok",
    imported,
    updated,
    skipped: skipped.slice(0, 20),
    message: `${imported} importados · ${updated} actualizados · ${skipped.length} omitidos`,
  };
}

export async function deleteCollaboratorAction(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(collaborators).where(eq(collaborators.id, id));
  revalidatePath("/admin/colaboradores");
}

export type InviteResult = { enviadas: number; sinCorreo: number; error?: string };

/**
 * Envía a cada colaborador el link de su empresa.
 *
 * Solo a quienes aún no lo recibieron (`invitedAt` nulo): reimportar el Excel
 * o apretar el botón dos veces no vuelve a escribirle a nadie. Marcamos
 * `invitedAt` recién cuando el correo salió.
 */
export async function sendCollaboratorInvitesAction(campaignId: string): Promise<InviteResult> {
  const actor = await requireAdmin();

  const [ctx] = await db
    .select({ campaign: campaigns, company: companies })
    .from(campaigns)
    .innerJoin(companies, eq(companies.id, campaigns.companyId))
    .where(eq(campaigns.id, campaignId));
  if (!ctx) return { enviadas: 0, sinCorreo: 0, error: "La campaña no existe." };
  if (!isCampaignOpen(ctx.campaign)) {
    return { enviadas: 0, sinCorreo: 0, error: "La campaña no está abierta: nadie podría entrar." };
  }

  const pendientes = await db
    .select()
    .from(collaborators)
    .where(and(eq(collaborators.campaignId, campaignId), isNull(collaborators.invitedAt)));

  const sinCorreo = pendientes.filter((c) => !c.email).length;
  const conCorreo = pendientes.filter((c) => c.email);
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/${ctx.company.slug}`;

  let enviadas = 0;
  for (const colaborador of conCorreo) {
    try {
      await sendEmail({
        to: [colaborador.email!],
        subject: `Tu regalo de ${ctx.company.name}, cortesía de Caramba`,
        html: collaboratorInviteHtml({
          companyName: ctx.company.name,
          bannerTitle: ctx.campaign.bannerTitle,
          url,
          quota: colaborador.quota,
          endsAt: ctx.campaign.endsAt,
        }),
      });
      await db
        .update(collaborators)
        .set({ invitedAt: new Date() })
        .where(eq(collaborators.id, colaborador.id));
      enviadas++;
    } catch (err) {
      // Un correo rebotado no debe frenar a los demás; el colaborador queda
      // sin marcar y entra en el próximo envío.
      console.error(`[invitación] falló para ${colaborador.email}:`, err);
    }
  }

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "collaborators_invite",
    entity: "campaign",
    entityId: campaignId,
    meta: { enviadas, sinCorreo, total: pendientes.length },
  });

  revalidatePath("/admin/colaboradores");
  return { enviadas, sinCorreo };
}
