import { NextRequest, NextResponse } from "next/server";
import { createAdminSession, redeemMagicLink } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Consume el magic link del correo y abre la sesión del panel.
 *
 * El GET NO canjea: muestra un interstitial con un botón (POST). Los escáneres
 * de correo corporativo (Outlook Safe Links, Proofpoint, Gmail) hacen GET a
 * los links al recibir el mensaje; si el GET canjeara, quemarían el token de
 * un solo uso antes del clic humano — y peor, recibirían la cookie de una
 * sesión admin válida. Los escáneres no envían formularios.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = req.nextUrl.origin;
  if (!token) return NextResponse.redirect(new URL("/admin/login", base));

  // OJO: no interpolar el token (ni nada del request) en el HTML. El form
  // postea a la misma URL, así que el token viaja en la query intacto.
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Entrar · Panel Caramba</title>
<style>
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:#f4f3e8;font-family:system-ui,-apple-system,sans-serif;color:#282828}
  .card{background:#fff;border:1px solid rgba(40,40,40,.08);border-radius:16px;
    padding:40px;max-width:380px;text-align:center;box-shadow:0 1px 2px rgba(40,40,40,.05)}
  .bar{height:6px;border-radius:99px;background:linear-gradient(90deg,#CC644F,#E1B946,#8CBEA3);margin-bottom:24px}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#555;font-size:14px;line-height:1.6;margin:0 0 24px}
  button{background:#CC644F;color:#fff;border:0;border-radius:999px;padding:14px 28px;
    font-size:15px;font-weight:600;cursor:pointer;width:100%}
  button:hover{background:#b85742}
</style>
</head>
<body>
  <main class="card">
    <div class="bar"></div>
    <h1>Panel Caramba</h1>
    <p>Confirma para entrar con tu enlace de acceso. El enlace es de un solo uso.</p>
    <form method="POST"><button type="submit">Entrar al panel</button></form>
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = req.nextUrl.origin;
  if (!token) return NextResponse.redirect(new URL("/admin/login", base), 303);

  // Un token es de 256 bits: adivinarlo es inviable, pero el tope evita que
  // alguien use este endpoint para sondear la base.
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_entrar:${ip}`, 30, 15 * 60);
  if (!allowed) return NextResponse.redirect(new URL("/admin/login?error=rate", base), 303);

  const user = await redeemMagicLink(token);
  if (!user) return NextResponse.redirect(new URL("/admin/login?expirado=1", base), 303);

  await createAdminSession(user.id);
  // Con contraseña temporal pendiente, primero la define.
  const destino = user.mustChangePassword ? "/admin/cuenta?forzar=1" : "/admin/pedidos";
  return NextResponse.redirect(new URL(destino, base), 303);
}
