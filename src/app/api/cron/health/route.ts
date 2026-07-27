import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notificationRecipients } from "@/db/schema";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { healthAlertHtml, sendEmail } from "@/lib/email/send";
import { generarReporteSalud } from "@/lib/health";

/**
 * Monitoreo: revisa la salud de la plataforma y AVISA por correo cuando algo
 * está mal. Antes nadie se enteraba si el espejo dejaba de repararse o un
 * pedido quedaba trabado — había que ir a mirar la base a mano.
 *
 * Silencioso por diseño: si todo está bien no manda nada (un correo diario que
 * siempre dice "ok" se ignora, y entonces el que importa también se ignora).
 * Schedule en vercel.json: cada 6 horas.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reporte = await generarReporteSalud();
  const problemas = reporte.chequeos.filter((c) => c.severidad !== "ok");

  if (problemas.length === 0) {
    console.log("[cron health] todo OK");
    return NextResponse.json({ ok: true, severidad: "ok", alertaEnviada: false });
  }

  // Destinatarios globales del panel (los mismos que reciben los pedidos).
  const destinatarios = await db
    .select({ email: notificationRecipients.email })
    .from(notificationRecipients)
    .where(and(eq(notificationRecipients.active, true), isNull(notificationRecipients.companyId)));

  const correos = destinatarios.map((d) => d.email);
  if (correos.length === 0) {
    console.warn("[cron health] hay problemas pero no hay destinatarios globales configurados");
    return NextResponse.json({ ok: true, severidad: reporte.severidad, alertaEnviada: false, motivo: "sin destinatarios" });
  }

  const severidad = reporte.severidad === "critico" ? "critico" : "aviso";
  try {
    await sendEmail({
      to: correos,
      subject:
        severidad === "critico"
          ? "Caramba B2B: algo necesita tu atención"
          : "Caramba B2B: aviso de la plataforma",
      html: healthAlertHtml({
        severidad,
        chequeos: problemas,
        panelUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      }),
    });
  } catch (err) {
    // Que falle el correo no debe tumbar el cron; queda en los logs igual.
    console.error("[cron health] no se pudo enviar la alerta:", err);
    return NextResponse.json({ ok: false, severidad: reporte.severidad, alertaEnviada: false }, { status: 500 });
  }

  console.warn(
    `[cron health] ${severidad}: ${problemas.map((p) => `${p.titulo} — ${p.detalle}`).join(" | ")}`,
  );
  return NextResponse.json({
    ok: true,
    severidad: reporte.severidad,
    alertaEnviada: true,
    problemas: problemas.map((p) => p.id),
  });
}
