import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailEvents } from "@/db/schema";

/**
 * Eventos de entregabilidad de Resend (rebotes, quejas, entregas).
 *
 * Existe porque un correo "aceptado" por Resend NO es un correo entregado: una
 * invitación con un typo, un buzón lleno o un ex-empleado rebotan DESPUÉS, y
 * hasta ahora nadie se enteraba — el colaborador simplemente nunca recibía su
 * regalo. Estos eventos alimentan la alerta de salud y la vista del panel.
 *
 * Configurar en Resend → Webhooks, apuntando a:
 *   {NEXT_PUBLIC_APP_URL}/api/webhooks/resend
 * y guardar el secreto en RESEND_WEBHOOK_SECRET.
 */
export const dynamic = "force-dynamic";

/** Verificación de firma del estándar Svix, que es el que usa Resend. */
function firmaValida(req: NextRequest, cuerpo: string): boolean {
  const secreto = process.env.RESEND_WEBHOOK_SECRET;
  if (!secreto) return false;

  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const firmas = req.headers.get("svix-signature");
  if (!id || !timestamp || !firmas) return false;

  // Rechazar eventos viejos: sin esto, una firma capturada sirve para siempre.
  const edadSegundos = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(edadSegundos) || edadSegundos > 300) return false;

  // El secreto viene como "whsec_<base64>"
  const clave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
  const esperada = createHmac("sha256", clave)
    .update(`${id}.${timestamp}.${cuerpo}`)
    .digest("base64");

  // El header trae una o más firmas: "v1,<firma> v1,<otra>"
  return firmas.split(" ").some((parte) => {
    const valor = parte.split(",")[1];
    if (!valor) return false;
    const a = Buffer.from(valor);
    const b = Buffer.from(esperada);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const TIPOS_QUE_IMPORTAN = new Set([
  "email.bounced",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
]);

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();

  if (!firmaValida(req, cuerpo)) {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let evento: {
    type?: string;
    created_at?: string;
    data?: { email_id?: string; to?: string[]; bounce?: { message?: string; type?: string } };
  };
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const tipo = evento.type ?? "";
  if (!TIPOS_QUE_IMPORTAN.has(tipo)) {
    return NextResponse.json({ ok: true, ignorado: tipo });
  }

  const destinatarios = evento.data?.to ?? [];
  if (destinatarios.length === 0) return NextResponse.json({ ok: true, sinDestinatario: true });

  const motivo =
    evento.data?.bounce?.message ??
    (evento.data?.bounce?.type ? `bounce ${evento.data.bounce.type}` : null);

  for (const email of destinatarios) {
    await db
      .insert(emailEvents)
      .values({
        messageId: evento.data?.email_id ?? null,
        email: email.toLowerCase(),
        tipo: tipo.replace(/^email\./, ""),
        motivo,
        ocurridoEn: evento.created_at ? new Date(evento.created_at) : new Date(),
      })
      // Resend reintenta: el mismo evento no debe duplicarse.
      .onConflictDoNothing();
  }

  if (tipo === "email.bounced" || tipo === "email.complained") {
    console.warn(`[resend] ${tipo} → ${destinatarios.join(", ")}${motivo ? `: ${motivo}` : ""}`);
  }

  return NextResponse.json({ ok: true });
}
