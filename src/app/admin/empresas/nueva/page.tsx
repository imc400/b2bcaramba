import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";
import { CompanyForm } from "../company-form";

export default async function NuevaEmpresaPage() {
  const actor = await requireAdmin();

  return (
    <AdminShell active="/admin/empresas" usuario={actor} title="Empresas › Nueva empresa">
      <CompanyForm
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        initial={{
          name: "",
          slug: "",
          logoUrl: "",
          campaignName: `Navidad ${new Date().getFullYear()}`,
          bannerTitle: "Elige el regalo de Navidad para tus hijos",
          bannerSubtitle: "",
          accentColor: "#8CBEA3",
          endsAt: "",
          defaultQuota: 1,
          safetyStock: 1,
          priceMinClp: "",
          priceMaxClp: "",
          tags: "",
          excludedTags: "",
          includedProducts: [],
          excludedProducts: [],
          status: "draft",
        }}
      />
    </AdminShell>
  );
}
