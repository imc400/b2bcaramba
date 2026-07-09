import { redirect } from "next/navigation";
import { getMicrositeSession } from "@/lib/auth/session";
import { getRemainingQuota } from "@/lib/orders";
import { SelectionProvider } from "../selection";
import { CartView } from "./cart-view";

export default async function CarritoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getMicrositeSession();
  if (!session || session.company.slug !== slug) redirect(`/${slug}`);

  const remaining = await getRemainingQuota(session.collaborator.id);
  if (remaining === 0) redirect(`/${slug}/tienda`);

  return (
    <SelectionProvider campaignId={session.campaign.id} quota={remaining}>
      <CartView
        slug={slug}
        collaboratorName={session.collaborator.name ?? ""}
        campaignId={session.campaign.id}
      />
    </SelectionProvider>
  );
}
