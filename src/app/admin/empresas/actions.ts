"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, campaigns, companies, type CatalogFilter } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import {
  getCampaignCatalog,
  searchProductsForCuration,
  type CurationProduct,
} from "@/lib/catalog";

const upsertSchema = z.object({
  companyId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug: solo minúsculas, números y guiones"),
  campaignName: z.string().min(2).max(80),
  bannerTitle: z.string().min(3).max(120),
  bannerSubtitle: z.string().max(160).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  endsAt: z.string().optional(),
  defaultQuota: z.coerce.number().int().min(1).max(10),
  safetyStock: z.coerce.number().int().min(0).max(20),
  priceMinClp: z.coerce.number().int().min(0).optional(),
  priceMaxClp: z.coerce.number().int().min(0).optional(),
  tags: z.string().optional(),
  excludedTags: z.string().optional(),
  // Arrays de IDs serializados como JSON en hidden inputs
  includeProductIds: z.string().optional(),
  excludeProductIds: z.string().optional(),
  logoUrl: z.string().optional(),
  status: z.enum(["draft", "active", "closed"]),
});

function parseIdArray(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
  } catch {
    return [];
  }
}

export type UpsertCompanyState = { status: "idle" | "error"; message?: string };

export async function upsertCompanyAction(
  _prev: UpsertCompanyState,
  formData: FormData,
): Promise<UpsertCompanyState> {
  await requireAdmin();

  const parsed = upsertSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
    };
  }
  const d = parsed.data;

  const catalogFilter: CatalogFilter = {};
  if (d.priceMinClp) catalogFilter.priceMinClp = d.priceMinClp;
  if (d.priceMaxClp) catalogFilter.priceMaxClp = d.priceMaxClp;
  const tags = d.tags
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags?.length) catalogFilter.tags = tags;
  const excludedTags = d.excludedTags
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (excludedTags?.length) catalogFilter.excludedTags = excludedTags;
  const includeIds = parseIdArray(d.includeProductIds);
  if (includeIds.length) catalogFilter.includeProductIds = includeIds;
  const excludeIds = parseIdArray(d.excludeProductIds);
  if (excludeIds.length) catalogFilter.excludeProductIds = excludeIds;

  let companyId = d.companyId;
  if (companyId) {
    await db
      .update(companies)
      .set({ name: d.name, slug: d.slug, logoUrl: d.logoUrl || null })
      .where(eq(companies.id, companyId));
  } else {
    const [created] = await db
      .insert(companies)
      .values({ name: d.name, slug: d.slug, logoUrl: d.logoUrl || null })
      .returning();
    companyId = created.id;
  }

  const campaignValues = {
    companyId,
    name: d.campaignName,
    status: d.status,
    bannerTitle: d.bannerTitle,
    bannerSubtitle: d.bannerSubtitle || null,
    theme: { accentColor: d.accentColor },
    endsAt: d.endsAt ? new Date(`${d.endsAt}T23:59:59-03:00`) : null,
    catalogFilter,
    defaultQuota: d.defaultQuota,
    safetyStock: d.safetyStock,
  };

  if (d.campaignId) {
    await db.update(campaigns).set(campaignValues).where(eq(campaigns.id, d.campaignId));
  } else {
    await db.insert(campaigns).values(campaignValues);
  }

  await db.insert(auditLog).values({
    actorEmail: "admin",
    action: d.companyId ? "company_update" : "company_create",
    entity: "company",
    entityId: companyId,
    meta: { name: d.name, slug: d.slug },
  });

  revalidatePath("/admin/empresas");
  redirect("/admin/empresas");
}

export type FilterPreviewInput = {
  priceMinClp?: number;
  priceMaxClp?: number;
  tags?: string[];
  excludedTags?: string[];
  vendors?: string[];
  includeProductIds?: number[];
  excludeProductIds?: number[];
  safetyStock: number;
};

function toCatalogFilter(input: FilterPreviewInput): CatalogFilter {
  const filter: CatalogFilter = {};
  if (input.priceMinClp) filter.priceMinClp = input.priceMinClp;
  if (input.priceMaxClp) filter.priceMaxClp = input.priceMaxClp;
  if (input.tags?.length) filter.tags = input.tags;
  if (input.excludedTags?.length) filter.excludedTags = input.excludedTags;
  if (input.vendors?.length) filter.vendors = input.vendors;
  if (input.includeProductIds?.length) filter.includeProductIds = input.includeProductIds;
  if (input.excludeProductIds?.length) filter.excludeProductIds = input.excludeProductIds;
  return filter;
}

/** Preview en vivo: productos que verá el colaborador con este filtro. */
export async function previewFilterAction(input: FilterPreviewInput): Promise<{
  total: number;
  sample: {
    shopifyId: number;
    title: string;
    vendor: string | null;
    featuredImageUrl: string | null;
    priceClp: number;
  }[];
}> {
  await requireAdmin();
  const { items, total } = await getCampaignCatalog({
    filter: toCatalogFilter(input),
    safetyStock: input.safetyStock,
    limit: 24,
    withFacets: false,
  });
  return {
    total,
    sample: items.map((i) => ({
      shopifyId: i.shopifyId,
      title: i.title,
      vendor: i.vendor,
      featuredImageUrl: i.featuredImageUrl,
      priceClp: 0, // el precio no se necesita en el preview de grilla
    })),
  };
}

/** Buscador de productos para curaduría manual. */
export async function searchProductsAction(query: string): Promise<CurationProduct[]> {
  await requireAdmin();
  if (query.trim().length < 2) return [];
  return searchProductsForCuration(query);
}
