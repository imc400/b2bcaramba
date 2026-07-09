import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { CoBrandHeader } from "@/components/brand";
import { Badge } from "@/components/ui";
import { getMicrositeSession } from "@/lib/auth/session";
import { getRemainingQuota } from "@/lib/orders";

export default async function MicrositeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Solo exige que la empresa exista y esté activa; el estado de la campaña
  // lo maneja cada página (campaña cerrada muestra su propia vista)
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);

  if (!company || !company.active) notFound();

  const session = await getMicrositeSession();
  const remaining =
    session && session.company.slug === slug
      ? await getRemainingQuota(session.collaborator.id)
      : null;

  return (
    <div className="min-h-dvh bg-white">
      <CoBrandHeader
        companyName={company.name}
        companyLogoUrl={company.logoUrl}
        right={
          remaining !== null ? (
            <Badge tone={remaining > 0 ? "verde" : "neutro"}>
              <span className="size-1.5 rounded-full bg-current opacity-70" />
              {remaining > 0
                ? `Te queda${remaining === 1 ? "" : "n"} ${remaining} regalo${remaining === 1 ? "" : "s"}`
                : "Cupo completo"}
            </Badge>
          ) : null
        }
      />
      {children}
      <footer className="mt-16 border-t border-caramba-grafito/8 py-8 text-center text-xs text-caramba-grafito/40">
        Beneficio gestionado por Caramba · la vida es para jugar
      </footer>
    </div>
  );
}
