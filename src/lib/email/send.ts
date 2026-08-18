import "server-only";
import { Resend } from "resend";

/**
 * Envío de correos. Con RESEND_API_KEY usa Resend; sin key (dev local)
 * loguea a consola para poder copiar el OTP y ver las notificaciones.
 */
export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Caramba <no-reply@caramba.cl>";

  if (!key) {
    console.log("\n═══ EMAIL (dev, sin RESEND_API_KEY) ═══");
    console.log("Para:", opts.to.join(", "));
    console.log("Asunto:", opts.subject);
    console.log(opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500));
    console.log("═══════════════════════════════════════\n");
    return;
  }

  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}

export type MensajeLote = { to: string; subject: string; html: string };

/**
 * Envío masivo por la API de lotes de Resend (hasta 100 por llamada).
 *
 * Existe porque invitar a una campaña grande de a uno era inviable: 2.000
 * colaboradores × ~300 ms = más de 10 minutos, y la acción moría por timeout
 * mucho antes. Con lotes son 20 llamadas.
 *
 * Devuelve los índices que SÍ salieron, para que el caller marque solo a esos
 * como invitados (los que fallan se reintentan en el próximo envío). Usa
 * validación permisiva: un correo malo del Excel no tumba el lote completo.
 */
export async function sendEmailBatch(
  mensajes: MensajeLote[],
): Promise<{ enviados: Set<number>; errores: { indice: number; motivo: string }[] }> {
  const enviados = new Set<number>();
  const errores: { indice: number; motivo: string }[] = [];
  if (mensajes.length === 0) return { enviados, errores };

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Caramba <no-reply@caramba.cl>";

  if (!key) {
    console.log(`\n═══ ${mensajes.length} EMAILS (dev, sin RESEND_API_KEY) ═══`);
    for (const [i, m] of mensajes.entries()) {
      console.log(`  → ${m.to}: ${m.subject}`);
      enviados.add(i);
    }
    console.log("═══════════════════════════════════════\n");
    return { enviados, errores };
  }

  const resend = new Resend(key);
  const TAMANO = 100; // tope de la API de lotes de Resend
  const PAUSA_MS = 600; // el plan free permite ~2 req/s

  for (let inicio = 0; inicio < mensajes.length; inicio += TAMANO) {
    const lote = mensajes.slice(inicio, inicio + TAMANO);
    if (inicio > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));

    try {
      const { data, error } = await resend.batch.send(
        lote.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html })),
        { batchValidation: "permissive" },
      );

      if (error) {
        // Falló el lote entero (rate limit, cuota, credenciales).
        for (let i = 0; i < lote.length; i++) {
          errores.push({ indice: inicio + i, motivo: error.message });
        }
        // Si es tope de cuota, seguir intentando solo gasta tiempo.
        if (/rate|limit|quota|too many/i.test(error.message)) {
          for (let i = inicio + lote.length; i < mensajes.length; i++) {
            errores.push({ indice: i, motivo: "no se intentó: límite de envío alcanzado" });
          }
          break;
        }
        continue;
      }

      const fallidos = new Map(
        ((data as { errors?: { index: number; message: string }[] } | null)?.errors ?? []).map(
          (e) => [e.index, e.message],
        ),
      );
      for (let i = 0; i < lote.length; i++) {
        const motivo = fallidos.get(i);
        if (motivo) errores.push({ indice: inicio + i, motivo });
        else enviados.add(inicio + i);
      }
    } catch (err) {
      for (let i = 0; i < lote.length; i++) {
        errores.push({ indice: inicio + i, motivo: String(err).slice(0, 120) });
      }
    }
  }

  return { enviados, errores };
}

const brandHeader = `
  <div style="height:6px;background:linear-gradient(90deg,#CC644F,#E1B946,#8CBEA3)"></div>
  <div style="background:#ffffff;padding:32px 0 8px;text-align:center">
    <span style="font-size:26px;font-weight:700;color:#282828;letter-spacing:-0.5px">Caramba</span>
    <div style="font-size:12px;color:#8a8a8a;margin-top:2px">la vida es para jugar</div>
  </div>`;

const brandFooter = `
  <div style="border-top:1px solid #eee;padding:16px 32px 24px;text-align:center">
    <p style="font-size:12px;color:#999;line-height:1.5">Recibiste este correo porque tu empresa te invitó a elegir un regalo con Caramba.<br/>¿Dudas? Responde este correo y te ayudamos.</p>
  </div>`;

/**
 * Escapa texto que entra a un correo. Los datos vienen de un Excel que sube la
 * empresa cliente: un nombre con `<script>` o `<img onerror>` no debe romper
 * (ni inyectar nada en) el correo que le llega a bodega.
 */
export function esc(texto: string | null | undefined): string {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const boton = (url: string, texto: string) =>
  `<a href="${url}" style="display:inline-block;background:#CC644F;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px;font-size:15px">${esc(texto)}</a>`;

/** Magic link para entrar al panel de Caramba. */
export function adminMagicLinkHtml(url: string, esInvitacion: boolean): string {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px;text-align:center">
      <h1 style="font-size:20px;color:#282828">${esInvitacion ? "Te invitaron al panel de Caramba" : "Tu acceso al panel"}</h1>
      <p style="color:#555;line-height:1.6">${
        esInvitacion
          ? "Desde aquí gestionas las empresas, las campañas y los pedidos de regalos corporativos."
          : "Haz click para entrar. No necesitas contraseña."
      }</p>
      <div style="margin:28px 0">${boton(url, esInvitacion ? "Activar mi cuenta" : "Entrar al panel")}</div>
      <p style="color:#999;font-size:13px">El enlace vence en ${esInvitacion ? "72 horas" : "30 minutos"} y sirve una sola vez.<br/>Si no lo pediste tú, ignora este correo.</p>
    </div>
    ${brandFooter}
  </div>`;
}

/** Invitación al colaborador con el link de su empresa. */
export function collaboratorInviteHtml(o: {
  companyName: string;
  bannerTitle: string;
  url: string;
  quota: number;
  endsAt: Date | null;
}): string {
  const cierre = o.endsAt
    ? `<p style="color:#8a6d1a;background:#faf3dd;border-radius:12px;padding:12px 16px;font-size:14px;margin:20px 0">Tienes hasta el ${o.endsAt.toLocaleDateString("es-CL", { day: "numeric", month: "long" })} para elegir.</p>`
    : "";
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <p style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#3f7a5c;margin:0">Beneficio ${esc(o.companyName)}</p>
      <h1 style="font-size:22px;color:#282828;margin:8px 0 0">${esc(o.bannerTitle)}</h1>
      <p style="color:#555;line-height:1.6;margin-top:14px">
        ${esc(o.companyName)} te regala <b>${o.quota} juguete${o.quota === 1 ? "" : "s"}</b> de Caramba, a tu elección.
        Entra con tu correo, elige y te lo enviamos a la dirección que nos digas.
      </p>
      ${cierre}
      <div style="margin:26px 0;text-align:center">${boton(o.url, "Elegir mi regalo")}</div>
      <p style="color:#999;font-size:13px;text-align:center">No pagas nada: el costo lo asume tu empresa.</p>
    </div>
    ${brandFooter}
  </div>`;
}

export function otpEmailHtml(code: string, companyName: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px;text-align:center">
      <h1 style="font-size:20px;color:#282828">Tu código de acceso</h1>
      <p style="color:#555">Para entrar a la tienda de regalos de <b>${esc(companyName)}</b>:</p>
      <div style="font-size:36px;letter-spacing:10px;font-weight:700;color:#282828;background:#f4f3e8;border-radius:12px;padding:20px;margin:24px 0">${code}</div>
      <p style="color:#999;font-size:13px">Vence en 10 minutos. Si no lo pediste tú, ignora este correo.</p>
    </div>
    ${brandFooter}
  </div>`;
}

export function orderNotificationHtml(o: {
  code: string;
  companyName: string;
  collaboratorName: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  comuna: string;
  items: { title: string; variantTitle: string | null; quantity: number }[];
}): string {
  const rows = o.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${esc(i.title)}${
          i.variantTitle && i.variantTitle !== "Default Title" ? ` · ${esc(i.variantTitle)}` : ""
        }</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td></tr>`,
    )
    .join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <h1 style="font-size:20px;color:#282828">Nuevo pedido ${esc(o.code)}</h1>
      <p style="color:#555"><b>${esc(o.companyName)}</b> · pedido de ${esc(o.collaboratorName)}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f4f3e8"><th style="padding:8px 12px;text-align:left">Producto</th><th style="padding:8px 12px">Cant.</th></tr>
        ${rows}
      </table>
      <p style="color:#555;line-height:1.6">
        <b>Despacho:</b> ${esc(o.recipientName)}<br/>
        ${esc(o.addressLine)}, ${esc(o.comuna)}<br/>
        Tel: ${esc(o.phone)}
      </p>
      <p style="color:#999;font-size:13px">Gestiona este pedido en el panel: ${process.env.NEXT_PUBLIC_APP_URL}/admin/pedidos</p>
    </div>
  </div>`;
}

export function orderConfirmationHtml(o: {
  code: string;
  collaboratorName: string;
  items: { title: string; quantity: number }[];
}): string {
  const list = o.items.map((i) => `<li>${esc(i.title)} ×${i.quantity}</li>`).join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <h1 style="font-size:20px;color:#282828">¡Pedido enviado!</h1>
      <p style="color:#555">Hola ${esc(o.collaboratorName)}, recibimos tu selección (${esc(o.code)}):</p>
      <ul style="color:#555;line-height:1.8">${list}</ul>
      <p style="color:#555">Te avisaremos cuando vaya en camino. ¡La vida es para jugar!</p>
    </div>
    ${brandFooter}
  </div>`;
}

/**
 * Aviso al colaborador cuando su pedido pasa a "despachado". Cumple la promesa
 * del correo de confirmación ("te avisaremos cuando vaya en camino").
 * Sin precios: el colaborador nunca los ve.
 */
export function orderShippedHtml(o: {
  code: string;
  collaboratorName: string;
  recipientName: string;
  addressLine: string;
  comuna: string;
  region: string | null;
  items: { title: string; variantTitle: string | null; quantity: number }[];
}): string {
  const list = o.items
    .map(
      (i) =>
        `<li>${esc(i.title)}${
          i.variantTitle && i.variantTitle !== "Default Title" ? ` · ${esc(i.variantTitle)}` : ""
        } ×${i.quantity}</li>`,
    )
    .join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <h1 style="font-size:20px;color:#282828">¡Tu pedido va en camino!</h1>
      <p style="color:#555;line-height:1.6">Hola ${esc(o.collaboratorName)}, tu pedido <b>${esc(o.code)}</b> ya fue despachado:</p>
      <ul style="color:#555;line-height:1.8">${list}</ul>
      <p style="color:#555;line-height:1.6">
        <b>Dirección de entrega:</b><br/>
        ${esc(o.recipientName)}<br/>
        ${esc(o.addressLine)}, ${esc(o.comuna)}${o.region ? `, ${esc(o.region)}` : ""}
      </p>
      <p style="color:#555">¡Que lo disfrutes! La vida es para jugar.</p>
    </div>
    ${brandFooter}
  </div>`;
}

/** Alerta de salud de la plataforma (la envía el cron de monitoreo). */
export function healthAlertHtml(o: {
  severidad: "aviso" | "critico";
  chequeos: { titulo: string; severidad: string; detalle: string; accion?: string }[];
  panelUrl: string;
}): string {
  const color = o.severidad === "critico" ? "#CC644F" : "#E1B946";
  const filas = o.chequeos
    .map((c) => {
      const icono = c.severidad === "critico" ? "●" : c.severidad === "aviso" ? "●" : "○";
      const tono = c.severidad === "critico" ? "#CC644F" : c.severidad === "aviso" ? "#8a6d1a" : "#3f7a5c";
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee">
          <div style="color:${tono};font-weight:600;font-size:14px">${icono} ${esc(c.titulo)}</div>
          <div style="color:#555;font-size:13px;margin-top:3px">${esc(c.detalle)}</div>
          ${c.accion ? `<div style="color:#999;font-size:12px;margin-top:4px">→ ${esc(c.accion)}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    <div style="height:6px;background:${color}"></div>
    <div style="padding:28px 32px 32px">
      <h1 style="font-size:19px;color:#282828;margin:0 0 6px">
        ${o.severidad === "critico" ? "Algo necesita tu atención" : "Aviso de la plataforma"}
      </h1>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 18px">
        Revisión automática de Caramba B2B. Solo te escribimos cuando hay algo que mirar.
      </p>
      <table style="width:100%;border-collapse:collapse">${filas}</table>
      <p style="margin-top:22px">${boton(`${o.panelUrl}/admin/ajustes`, "Ver estado en el panel")}</p>
    </div>
  </div>`;
}
