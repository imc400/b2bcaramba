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

export function otpEmailHtml(code: string, companyName: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px;text-align:center">
      <h1 style="font-size:20px;color:#282828">Tu código de acceso</h1>
      <p style="color:#555">Para entrar a la tienda de regalos de <b>${companyName}</b>:</p>
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
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${i.title}${
          i.variantTitle && i.variantTitle !== "Default Title" ? ` · ${i.variantTitle}` : ""
        }</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td></tr>`,
    )
    .join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <h1 style="font-size:20px;color:#282828">Nuevo pedido ${o.code}</h1>
      <p style="color:#555"><b>${o.companyName}</b> · pedido de ${o.collaboratorName}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f4f3e8"><th style="padding:8px 12px;text-align:left">Producto</th><th style="padding:8px 12px">Cant.</th></tr>
        ${rows}
      </table>
      <p style="color:#555;line-height:1.6">
        <b>Despacho:</b> ${o.recipientName}<br/>
        ${o.addressLine}, ${o.comuna}<br/>
        Tel: ${o.phone}
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
  const list = o.items.map((i) => `<li>${i.title} ×${i.quantity}</li>`).join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden">
    ${brandHeader}
    <div style="padding:8px 40px 40px">
      <h1 style="font-size:20px;color:#282828">¡Pedido enviado!</h1>
      <p style="color:#555">Hola ${o.collaboratorName}, recibimos tu selección (${o.code}):</p>
      <ul style="color:#555;line-height:1.8">${list}</ul>
      <p style="color:#555">Te avisaremos cuando vaya en camino. ¡La vida es para jugar!</p>
    </div>
    ${brandFooter}
  </div>`;
}
