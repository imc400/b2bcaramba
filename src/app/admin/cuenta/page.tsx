import { AdminShell } from "@/components/admin-shell";
import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { ChangePasswordForm } from "./change-password-form";

export default async function CuentaPage({
  searchParams,
}: {
  searchParams: Promise<{ forzar?: string }>;
}) {
  const actor = await requireAdmin();
  const { forzar } = await searchParams;
  const forzado = forzar === "1" || actor.mustChangePassword;

  return (
    <AdminShell active="/admin/cuenta" usuario={actor} title="Mi cuenta">
      <div className="max-w-md space-y-6">
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-display text-base text-caramba-grafito">
              {actor.name ?? actor.email}
            </h2>
            <p className="text-sm text-caramba-grafito/60">{actor.email}</p>
            <div className="mt-2">
              <Badge tone={actor.role === "owner" ? "verde" : "neutro"}>
                {actor.role === "owner" ? "Propietario" : "Editor"}
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          {forzado ? (
            <p className="mb-4 rounded-xl bg-caramba-amarillo-soft px-4 py-3 text-sm text-caramba-amarillo-texto">
              Estás usando una contraseña temporal. Define una propia para continuar.
            </p>
          ) : null}
          <h2 className="font-display text-base text-caramba-grafito">
            {forzado ? "Define tu contraseña" : "Cambiar contraseña"}
          </h2>
          <ChangePasswordForm forzado={forzado} />
        </Card>
      </div>
    </AdminShell>
  );
}
