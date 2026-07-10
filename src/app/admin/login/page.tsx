import { redirect } from "next/navigation";
import { CarambaLogo } from "@/components/brand";
import { Card } from "@/components/ui";
import { isAdminAuthenticated } from "@/lib/auth/admin";
import { LoginForm } from "./login-form";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expirado?: string }>;
}) {
  if (await isAdminAuthenticated()) redirect("/admin/pedidos");
  const { error, expirado } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-caramba-crema px-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex justify-center">
          <CarambaLogo className="h-12 w-auto" />
        </div>
        <h1 className="text-center font-display text-xl text-caramba-grafito">Panel Caramba</h1>
        <p className="mt-1 text-center text-sm text-caramba-grafito/70">
          Gestión de regalos corporativos
        </p>

        {expirado ? (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto"
          >
            Ese enlace ya se usó o venció. Pide uno nuevo.
          </p>
        ) : null}

        <LoginForm
          errorPassword={error === "1"}
          rateLimited={error === "rate"}
          emergenciaDisponible={Boolean(process.env.ADMIN_PASSWORD)}
        />
      </Card>
    </main>
  );
}
