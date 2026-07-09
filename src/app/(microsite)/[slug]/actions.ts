"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { campaigns, collaborators, companies } from "@/db/schema";
import { createOtp, verifyOtp } from "@/lib/auth/otp";
import { normalizeRut } from "@/lib/auth/rut";
import { createSession, getMicrositeSession } from "@/lib/auth/session";
import { getRemainingQuota, createOrder } from "@/lib/orders";
import { otpEmailHtml, sendEmail } from "@/lib/email/send";

/** Campaña activa de un slug (empresa). */
async function activeCampaignBySlug(slug: string) {
  const [row] = await db
    .select({ company: companies, campaign: campaigns })
    .from(companies)
    .innerJoin(campaigns, eq(campaigns.companyId, companies.id))
    .where(
      and(eq(companies.slug, slug), eq(companies.active, true), eq(campaigns.status, "active")),
    )
    .orderBy(campaigns.createdAt)
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Paso 1: identificación (correo o RUT) → envío de OTP
// Anti-enumeración: SIEMPRE la misma respuesta, exista o no el colaborador.
// ---------------------------------------------------------------------------

const identifySchema = z.object({
  slug: z.string().min(1),
  identifier: z.string().min(3).max(120),
});

export type IdentifyState = { status: "idle" | "sent" | "rate_limited"; maskedEmail?: string };

export async function identifyAction(
  _prev: IdentifyState,
  formData: FormData,
): Promise<IdentifyState> {
  const parsed = identifySchema.safeParse({
    slug: formData.get("slug"),
    identifier: formData.get("identifier"),
  });
  // Respuesta genérica incluso ante input inválido
  if (!parsed.success) return { status: "sent" };

  const ctx = await activeCampaignBySlug(parsed.data.slug);
  if (!ctx) return { status: "sent" };

  const raw = parsed.data.identifier.trim().toLowerCase();
  const rut = normalizeRut(raw);

  const [collab] = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.campaignId, ctx.campaign.id),
        rut ? eq(collaborators.rut, rut) : eq(collaborators.email, raw),
      ),
    )
    .limit(1);

  if (collab?.email) {
    const otp = await createOtp(collab.id);
    if (otp.ok === false) return { status: "rate_limited" };
    await sendEmail({
      to: [collab.email],
      subject: `${otp.code} es tu código · Regalos ${ctx.company.name}`,
      html: otpEmailHtml(otp.code, ctx.company.name),
    });
  }
  // Mismo mensaje exista o no; enmascaramos solo si existe (no revela nada
  // nuevo a quien ya conoce el correo que ingresó)
  return {
    status: "sent",
    maskedEmail: collab?.email ? maskEmail(collab.email) : undefined,
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  const visible = user.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, user.length - 2))}@${domain}`;
}

// ---------------------------------------------------------------------------
// Paso 2: verificación del OTP → sesión
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  slug: z.string().min(1),
  identifier: z.string().min(3).max(120),
  code: z.string().regex(/^\d{6}$/),
});

export type VerifyState = { status: "idle" | "invalid" | "ok" };

export async function verifyOtpAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = verifySchema.safeParse({
    slug: formData.get("slug"),
    identifier: formData.get("identifier"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { status: "invalid" };

  const ctx = await activeCampaignBySlug(parsed.data.slug);
  if (!ctx) return { status: "invalid" };

  const raw = parsed.data.identifier.trim().toLowerCase();
  const rut = normalizeRut(raw);
  const [collab] = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.campaignId, ctx.campaign.id),
        rut ? eq(collaborators.rut, rut) : eq(collaborators.email, raw),
      ),
    )
    .limit(1);
  if (!collab) return { status: "invalid" };

  const valid = await verifyOtp(collab.id, parsed.data.code);
  if (!valid) return { status: "invalid" };

  await createSession(collab.id, ctx.campaign.id);
  revalidatePath(`/${parsed.data.slug}`);
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Paso 3: envío del pedido
// ---------------------------------------------------------------------------

const orderSchema = z.object({
  variantIds: z.array(z.number().int().positive()).min(1).max(10),
  recipientName: z.string().min(3).max(120),
  phone: z.string().min(8).max(20),
  addressLine: z.string().min(5).max(200),
  comuna: z.string().min(2).max(80),
  addressNotes: z.string().max(300).optional(),
});

export type SubmitOrderState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; code: string };

export async function submitOrderAction(
  _prev: SubmitOrderState,
  formData: FormData,
): Promise<SubmitOrderState> {
  const session = await getMicrositeSession();
  if (!session) return { status: "error", message: "Tu sesión expiró. Vuelve a ingresar." };

  let variantIds: number[];
  try {
    variantIds = JSON.parse(String(formData.get("variantIds") ?? "[]"));
  } catch {
    return { status: "error", message: "Selección inválida." };
  }

  const parsed = orderSchema.safeParse({
    variantIds,
    recipientName: formData.get("recipientName"),
    phone: formData.get("phone"),
    addressLine: formData.get("addressLine"),
    comuna: formData.get("comuna"),
    addressNotes: formData.get("addressNotes") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Revisa los campos del formulario." };
  }

  const result = await createOrder({
    collaboratorId: session.collaborator.id,
    campaignId: session.campaign.id,
    companyId: session.company.id,
    variantIds: parsed.data.variantIds,
    recipientName: parsed.data.recipientName,
    phone: parsed.data.phone,
    email: session.collaborator.email,
    addressLine: parsed.data.addressLine,
    comuna: parsed.data.comuna,
    region: null,
    addressNotes: parsed.data.addressNotes ?? null,
  });

  if (!result.ok) {
    const messages: Record<typeof result.error, string> = {
      cupo_excedido: "Tu selección supera tu cupo disponible.",
      sin_stock: "Uno de los productos se agotó justo ahora. Quítalo y elige otro.",
      campana_cerrada: "Esta campaña ya cerró.",
      seleccion_vacia: "No has elegido ningún regalo.",
    };
    return { status: "error", message: messages[result.error] };
  }

  // OJO: sin revalidatePath aquí — re-renderizaría /carrito con cupo 0 y su
  // redirect a /tienda le ganaría al router.push del cliente hacia /listo.
  return { status: "ok", code: result.code };
}

/** Cupo restante del colaborador con sesión activa (para la UI). */
export async function remainingQuotaAction(): Promise<number> {
  const session = await getMicrositeSession();
  if (!session) return 0;
  return getRemainingQuota(session.collaborator.id);
}
