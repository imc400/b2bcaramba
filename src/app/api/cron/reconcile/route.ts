import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { reconcileCatalogCore } from "@/lib/shopify/reconcile";

// Capa 2 del espejo: reconciliación incremental horaria vía Vercel Cron
// (fallback cuando Inngest no está conectado en producción). Schedule en
// vercel.json: "0 * * * *".
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await reconcileCatalogCore();
    console.log(
      `[cron reconcile] ${result.totalSynced} productos re-sincronizados desde ${result.since}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron reconcile] falló:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
