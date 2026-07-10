/**
 * Comprueba que el envío de correos funciona de verdad.
 *
 *   pnpm verify:email tu-correo@ejemplo.cl
 *
 * Envía un correo real con la plantilla de invitación de la plataforma.
 * Sin RESEND_API_KEY avisa que solo se está logueando a consola.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const destino = process.argv.find((a) => a.includes("@"));
  if (!destino) {
    console.error("Uso: pnpm verify:email tu-correo@ejemplo.cl");
    process.exit(1);
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "(sin EMAIL_FROM)";
  console.log(`De:   ${from}`);
  console.log(`Para: ${destino}`);
  console.log(`Resend: ${key ? `configurado (${key.slice(0, 6)}…)` : "NO configurado"}\n`);

  if (!key) {
    console.log("Sin RESEND_API_KEY los correos solo se imprimen en la consola del servidor.");
    console.log("Los colaboradores NO recibirán su código de acceso.");
    console.log("Sigue la guía: docs/setup-resend.md\n");
  }

  const { sendEmail, collaboratorInviteHtml } = await import("../src/lib/email/send");

  await sendEmail({
    to: [destino],
    subject: "Prueba de envío · Plataforma B2B Caramba",
    html: collaboratorInviteHtml({
      companyName: "Empresa de Prueba",
      bannerTitle: "Elige tu regalo de Navidad",
      url: `${process.env.NEXT_PUBLIC_APP_URL}/entel`,
      quota: 2,
      endsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    }),
  });

  if (key) {
    console.log("✓ Resend aceptó el correo. Revisa tu bandeja (y spam los primeros días).\n");
  }
  process.exit(0);
}

main().catch((e) => {
  const msg = String(e?.message ?? e);
  console.error("\n✗", msg.slice(0, 300));
  if (msg.includes("domain")) {
    console.error("  El dominio no está verificado en Resend, o la clave apunta a otro dominio.");
  }
  process.exit(1);
});
