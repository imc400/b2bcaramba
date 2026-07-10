import { desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, companies, products } from "@/db/schema";
import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";
import { CompanyForm, type ProductRef } from "../company-form";

/** Carga refs (título/imagen) para los IDs curados guardados en el filtro. */
async function loadProductRefs(ids: number[] | undefined): Promise<ProductRef[]> {
  if (!ids?.length) return [];
  const rows = await db
    .select({
      shopifyId: products.shopifyId,
      title: products.title,
      vendor: products.vendor,
      featuredImageUrl: products.featuredImageUrl,
    })
    .from(products)
    .where(inArray(products.shopifyId, ids));
  return rows;
}

export default async function EditarEmpresaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) notFound();

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.companyId, id))
    .orderBy(desc(campaigns.createdAt))
    .limit(1);

  const [includedProducts, excludedProducts] = await Promise.all([
    loadProductRefs(campaign?.catalogFilter.includeProductIds),
    loadProductRefs(campaign?.catalogFilter.excludeProductIds),
  ]);

  return (
    <AdminShell active="/admin/empresas" usuario={actor} title={`Empresas › ${company.name}`}>
      <CompanyForm
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        initial={{
          companyId: company.id,
          campaignId: campaign?.id,
          name: company.name,
          slug: company.slug,
          logoUrl: company.logoUrl ?? "",
          campaignName: campaign?.name ?? `Navidad ${new Date().getFullYear()}`,
          bannerTitle: campaign?.bannerTitle ?? "",
          bannerSubtitle: campaign?.bannerSubtitle ?? "",
          accentColor: campaign?.theme?.accentColor ?? "#8CBEA3",
          endsAt: campaign?.endsAt ? campaign.endsAt.toISOString().slice(0, 10) : "",
          defaultQuota: campaign?.defaultQuota ?? 1,
          safetyStock: campaign?.safetyStock ?? 1,
          priceMinClp: campaign?.catalogFilter.priceMinClp?.toString() ?? "",
          priceMaxClp: campaign?.catalogFilter.priceMaxClp?.toString() ?? "",
          tags: campaign?.catalogFilter.tags?.join(", ") ?? "",
          excludedTags: campaign?.catalogFilter.excludedTags?.join(", ") ?? "",
          includedProducts,
          excludedProducts,
          status: campaign?.status ?? "draft",
        }}
      />
    </AdminShell>
  );
}
