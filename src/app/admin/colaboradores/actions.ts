"use server";

import ExcelJS from "exceljs";
import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, campaigns, collaborators, companies, orderItems, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { isValidRut, normalizeRut } from "@/lib/auth/rut";
import { isCampaignOpen } from "@/lib/campaign";
import { collaboratorInviteHtml, sendEmailBatch } from "@/lib/email/send";

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

  const resultado = await importarColaboradores({ campaignId, file, actorEmail: actor.email });
  revalidatePath("/admin/colaboradores");
  return resultado;
}

/**
 * Núcleo del import, sin sesión: así se puede probar a escala fuera de una
 * request (ver scripts/test-import-escala.ts). El action de arriba autentica
 * y delega aquí.
 */
export async function importarColaboradores({
  campaignId,
  file,
  actorEmail,
}: {
  campaignId: string;
  file: File;
  actorEmail: string;
}): Promise<ImportResult> {

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { status: "error", message: "Campaña no existe." };

  // --- Parsear filas -------------------------------------------------------
  // Se decide por el CONTENIDO, no por la extensión: los Excel que mandan las
  // empresas vienen renombrados a mano con muchísima frecuencia (un .xls
  // guardado como .xlsx, o al revés) y confiar en el nombre hace fallar un
  // archivo que en realidad es válido.
  //   .xlsx → ZIP, empieza con "PK"        (50 4B)
  //   .xls  → OLE2, empieza con D0 CF 11 E0
  let rows: string[][];
  try {
    const buffer = await file.arrayBuffer();
    const firma = new Uint8Array(buffer.slice(0, 4));
    const esZip = firma[0] === 0x50 && firma[1] === 0x4b; // xlsx
    const esOle = firma[0] === 0xd0 && firma[1] === 0xcf && firma[2] === 0x11 && firma[3] === 0xe0; // xls

    if (esZip) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      rows = [];
      sheet.eachRow((row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          values.push(String(cell.value ?? "").trim());
        });
        rows.push(values);
      });
    } else if (esOle) {
      // ExcelJS no lee el formato binario antiguo; SheetJS sí.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "array" });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      rows = (XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, raw: false }) as unknown[][]).map(
        (fila) => fila.map((c) => String(c ?? "").trim()),
      );
    } else if (/\.xlsx?$/i.test(file.name)) {
      // Se llama Excel pero no lo es: archivo corrupto o a medio descargar.
      // Sin este caso caía al lector de texto y devolvía "no tiene filas de
      // datos", que despista a quien solo quiere subir su lista.
      return {
        status: "error",
        message:
          "Ese archivo parece dañado: tiene nombre de Excel pero no se puede abrir. Ábrelo en Excel y vuelve a guardarlo, o descárgalo de nuevo.",
      };
    } else {
      // Texto plano: CSV o separado por punto y coma (lo que exporta Excel en Chile).
      const text = new TextDecoder("utf-8").decode(buffer);
      rows = text
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => l.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
    }
  } catch {
    return {
      status: "error",
      message: "No se pudo leer el archivo. Acepta Excel (.xlsx o .xls) y CSV.",
    };
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

  // --- Upsert POR LOTES ----------------------------------------------------
  // Antes esto hacía 2 consultas por fila, secuenciales: con 2.000
  // colaboradores son 4.000 viajes a Supabase (São Paulo) y la acción moría
  // por timeout. Ahora: 1 lectura + N/500 escrituras.
  let imported = 0;
  let updated = 0;
  const skipped: { row: number; reason: string }[] = [];

  // 1) Todo lo que ya existe en la campaña, de una vez.
  const existentes = await db
    .select({
      id: collaborators.id,
      email: collaborators.email,
      rut: collaborators.rut,
      name: collaborators.name,
    })
    .from(collaborators)
    .where(eq(collaborators.campaignId, campaignId));

  const porEmail = new Map(existentes.filter((e) => e.email).map((e) => [e.email!, e]));
  const porRut = new Map(existentes.filter((e) => e.rut).map((e) => [e.rut!, e]));

  type Nuevo = { email: string | null; rut: string | null; name: string | null; quota: number };
  type Cambio = { id: string; name: string | null; quota: number; rut: string | null };
  const nuevos: Nuevo[] = [];
  const cambios: Cambio[] = [];
  // El mismo correo puede venir repetido dentro del archivo: la última fila
  // gana, igual que antes (cuando la segunda encontraba a la primera en la DB).
  const vistosEmail = new Map<string, number>();
  const vistosRut = new Map<string, number>();

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

    // ¿Ya está en la base? (mismo criterio de antes: correo manda, si no RUT)
    const yaExiste = email ? porEmail.get(email) : porRut.get(rut!);
    if (yaExiste) {
      cambios.push({
        id: yaExiste.id,
        name: name || yaExiste.name,
        quota,
        rut: rut ?? yaExiste.rut,
      });
      continue;
    }

    // ¿Duplicado dentro del propio archivo? Sobrescribimos la entrada previa.
    const idxPrevio = email ? vistosEmail.get(email) : vistosRut.get(rut!);
    if (idxPrevio !== undefined) {
      nuevos[idxPrevio] = { email, rut, name, quota };
      continue;
    }
    if (email) vistosEmail.set(email, nuevos.length);
    if (rut) vistosRut.set(rut, nuevos.length);
    nuevos.push({ email, rut, name, quota });
  }

  // 2) Escrituras en lotes (Postgres tiene tope de parámetros por sentencia).
  const LOTE = 500;
  for (let i = 0; i < nuevos.length; i += LOTE) {
    const lote = nuevos.slice(i, i + LOTE);
    await db.insert(collaborators).values(
      lote.map((n) => ({
        companyId: campaign.companyId,
        campaignId,
        email: n.email,
        rut: n.rut,
        name: n.name,
        quota: n.quota,
      })),
    );
    imported += lote.length;
  }

  // UPDATE ... FROM (VALUES ...): una sentencia por lote en vez de una por fila.
  for (let i = 0; i < cambios.length; i += LOTE) {
    const lote = cambios.slice(i, i + LOTE);
    const valores = sql.join(
      lote.map(
        (c) =>
          sql`(${c.id}::uuid, ${c.name}::text, ${c.quota}::int, ${c.rut}::text)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE collaborators AS c
      SET name = v.name, quota = v.quota, rut = v.rut
      FROM (VALUES ${valores}) AS v(id, name, quota, rut)
      WHERE c.id = v.id`);
    updated += lote.length;
  }

  await db.insert(auditLog).values({
    actorEmail,
    action: "collaborators_import",
    entity: "campaign",
    entityId: campaignId,
    meta: { file: file.name, imported, updated, skipped: skipped.length },
  });

  return {
    status: "ok",
    imported,
    updated,
    skipped: skipped.slice(0, 20),
    message: `${imported} importados · ${updated} actualizados · ${skipped.length} omitidos`,
  };
}

/**
 * Elimina un colaborador. Se niega si ya pidió: sus pedidos son un registro
 * histórico (y la FK es RESTRICT, así que igual fallaría, pero con un error
 * feo). En ese caso lo correcto es dejarlo y, si hace falta, bajarle el cupo.
 */
export async function deleteCollaboratorAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin();

  const [colab] = await db.select().from(collaborators).where(eq(collaborators.id, id)).limit(1);
  if (!colab) return { ok: false, error: "Ese colaborador ya no existe." };

  const [{ pedidos }] = await db
    .select({ pedidos: count() })
    .from(orders)
    .where(eq(orders.collaboratorId, id));

  if (Number(pedidos) > 0) {
    return {
      ok: false,
      error: `${colab.name ?? colab.email ?? "Este colaborador"} ya tiene ${pedidos} pedido(s) y no se puede eliminar. Si no debe pedir más, déjale el cupo en 0.`,
    };
  }

  await db.delete(collaborators).where(eq(collaborators.id, id));
  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "collaborator_delete",
    entity: "collaborator",
    entityId: id,
    meta: { email: colab.email, rut: colab.rut, name: colab.name },
  });
  revalidatePath("/admin/colaboradores");
  return { ok: true };
}

/**
 * Corrige los datos de un colaborador. Sin esto, un correo mal tipeado en el
 * Excel obligaba a re-importar y dejaba la fila errónea viva — recibiendo una
 * invitación real a un desconocido.
 */
export async function updateCollaboratorAction(
  id: string,
  datos: { email: string; rut: string; name: string; quota: number },
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin();

  const [colab] = await db.select().from(collaborators).where(eq(collaborators.id, id)).limit(1);
  if (!colab) return { ok: false, error: "Ese colaborador ya no existe." };

  const email = datos.email.trim().toLowerCase() || null;
  const nombre = datos.name.trim() || null;
  const rutCrudo = datos.rut.trim();
  let rut: string | null = null;
  if (rutCrudo) {
    if (!isValidRut(rutCrudo)) return { ok: false, error: "El RUT no es válido." };
    rut = normalizeRut(rutCrudo);
  }

  if (!email && !rut) {
    return { ok: false, error: "Necesita correo o RUT: es su forma de entrar." };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "El correo no tiene un formato válido." };
  }

  const cupo = Number(datos.quota);
  if (!Number.isInteger(cupo) || cupo < 0 || cupo > 50) {
    return { ok: false, error: "El cupo debe ser un número entre 0 y 50." };
  }

  // No dejar el cupo por debajo de lo que ya pidió: rompería la contabilidad.
  const [{ usados }] = await db
    .select({ usados: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.collaboratorId, id), sql`${orders.status} <> 'anulado'`));

  if (cupo < Number(usados)) {
    return { ok: false, error: `Ya eligió ${usados} regalo(s): el cupo no puede quedar por debajo.` };
  }

  // Unicidad dentro de la campaña (los índices únicos existen; damos el mensaje bueno).
  const choques = await db
    .select({ id: collaborators.id })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.campaignId, colab.campaignId),
        ne(collaborators.id, id),
        email && rut
          ? or(eq(collaborators.email, email), eq(collaborators.rut, rut))!
          : email
            ? eq(collaborators.email, email)
            : eq(collaborators.rut, rut!),
      ),
    )
    .limit(1);
  if (choques.length > 0) {
    return { ok: false, error: "Ya hay otro colaborador con ese correo o RUT en esta campaña." };
  }

  await db
    .update(collaborators)
    .set({ email, rut, name: nombre, quota: cupo })
    .where(eq(collaborators.id, id));

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "collaborator_update",
    entity: "collaborator",
    entityId: id,
    meta: {
      antes: { email: colab.email, rut: colab.rut, name: colab.name, quota: colab.quota },
      despues: { email, rut, name: nombre, quota: cupo },
    },
  });
  revalidatePath("/admin/colaboradores");
  return { ok: true };
}

export type InviteResult = {
  enviadas: number;
  sinCorreo: number;
  /** No salieron (rebote, límite del plan): reaparecen como pendientes */
  fallidas?: number;
  error?: string;
};

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

  // Envío por lotes: de a uno, 2.000 colaboradores × ~300 ms superaban los 10
  // minutos y la acción moría por timeout. Con lotes de 100 son 20 llamadas.
  const { enviados, errores } = await sendEmailBatch(
    conCorreo.map((c) => ({
      to: c.email!,
      subject: `Tu regalo de ${ctx.company.name}, cortesía de Caramba`,
      html: collaboratorInviteHtml({
        companyName: ctx.company.name,
        bannerTitle: ctx.campaign.bannerTitle,
        url,
        quota: c.quota,
        endsAt: ctx.campaign.endsAt,
      }),
    })),
  );

  // Solo se marcan los que SÍ salieron: los demás reaparecen como pendientes
  // y se reintentan en el próximo envío.
  const idsEnviados = [...enviados].map((i) => conCorreo[i].id);
  const LOTE_UPDATE = 500;
  for (let i = 0; i < idsEnviados.length; i += LOTE_UPDATE) {
    await db
      .update(collaborators)
      .set({ invitedAt: new Date() })
      .where(inArray(collaborators.id, idsEnviados.slice(i, i + LOTE_UPDATE)));
  }

  const enviadas = idsEnviados.length;
  if (errores.length > 0) {
    console.error(
      `[invitaciones ${ctx.company.slug}] ${errores.length} fallaron:`,
      errores.slice(0, 5).map((e) => `${conCorreo[e.indice]?.email}: ${e.motivo}`).join(" | "),
    );
  }

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: "collaborators_invite",
    entity: "campaign",
    entityId: campaignId,
    meta: { enviadas, sinCorreo, fallidas: errores.length, total: pendientes.length },
  });

  revalidatePath("/admin/colaboradores");
  // fallidas se reporta a la UI: antes un envío parcial se veía como éxito.
  return { enviadas, sinCorreo, fallidas: errores.length };
}
