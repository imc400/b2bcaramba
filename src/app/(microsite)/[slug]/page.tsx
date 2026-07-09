import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { campaigns, companies } from "@/db/schema";
import { getMicrositeSession } from "@/lib/auth/session";
import { isCampaignOpen } from "@/lib/campaign";
import { AccessForm } from "./access-form";
import { accentText, BannerDecoration, ToyIcon } from "@/components/brand";

export default async function AccessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await getMicrositeSession();
  if (session && session.company.slug === slug) redirect(`/${slug}/tienda`);

  const [ctx] = await db
    .select({ company: companies, campaign: campaigns })
    .from(companies)
    .innerJoin(campaigns, eq(campaigns.companyId, companies.id))
    .where(and(eq(companies.slug, slug), eq(campaigns.status, "active")))
    .limit(1);

  // El layout garantiza que la empresa existe. Sin campaña abierta (status o
  // fecha límite vencida) mostramos el cierre acá, y no cuando el colaborador
  // ya armó su carrito.
  if (!ctx || !isCampaignOpen(ctx.campaign)) {
    const [company] = await db.select().from(companies).where(eq(companies.slug, slug));
    return <CampaignClosed companyName={company?.name ?? "tu empresa"} />;
  }

  const accent = ctx.campaign.theme?.accentColor ?? "#8CBEA3";
  const textColor = accentText(accent);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Banner de campaña */}
      <section
        className="relative mt-6 overflow-hidden rounded-3xl px-8 py-12 sm:px-12"
        style={{
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
          color: textColor,
        }}
      >
        <BannerDecoration icon="rocking-horse" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
            {ctx.campaign.name} · beneficio {ctx.company.name}
          </p>
          <h1 className="mt-3 max-w-xl text-3xl leading-tight sm:text-4xl">
            {ctx.campaign.bannerTitle}
          </h1>
          {ctx.campaign.bannerSubtitle ? (
            <p className="mt-3 max-w-lg opacity-85">{ctx.campaign.bannerSubtitle}</p>
          ) : null}
        </div>
      </section>

      {/* Acceso */}
      <section className="mx-auto -mt-8 mb-20 max-w-md">
        <AccessForm slug={slug} companyName={ctx.company.name} />
        <div className="mt-10 flex items-center justify-center gap-6 opacity-60">
          <ToyIcon name="drum" className="size-9" />
          <ToyIcon name="rocking-horse" className="size-9" />
          <ToyIcon name="teddy-bear" className="size-9" />
          <ToyIcon name="plane" className="size-9" />
        </div>
      </section>
    </main>
  );
}

function CampaignClosed({ companyName }: { companyName: string }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="flex items-center gap-5 opacity-50">
        <ToyIcon name="sand-bucket" className="size-10" />
        <ToyIcon name="beach-ball" className="size-10" />
        <ToyIcon name="sled-1" className="size-10" />
      </div>
      <h1 className="mt-8 font-display text-2xl text-caramba-grafito">Esta campaña ya cerró</h1>
      <p className="mt-3 text-caramba-grafito/70">
        El período para elegir regalos de {companyName} terminó. Si crees que es un error,
        contacta a Recursos Humanos de tu empresa.
      </p>
    </main>
  );
}
