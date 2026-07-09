import { redirect } from "next/navigation";
import { CarambaLogo } from "@/components/brand";
import { Button, Card, Field, Input } from "@/components/ui";
import { createAdminSession, isAdminAuthenticated, verifyAdminPassword } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

async function loginAction(formData: FormData) {
  "use server";
  // Password única compartida: sin tope, un bot la revienta por fuerza bruta.
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`admin_login:${ip}`, 8, 15 * 60);
  if (!allowed) redirect("/admin/login?error=rate");

  const password = String(formData.get("password") ?? "");
  if (!verifyAdminPassword(password)) {
    redirect("/admin/login?error=1");
  }
  await createAdminSession();
  redirect("/admin/pedidos");
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdminAuthenticated()) redirect("/admin/pedidos");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-caramba-crema px-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex justify-center">
          <CarambaLogo className="h-12 w-auto" />
        </div>
        <h1 className="text-center font-display text-xl text-caramba-grafito">Panel Caramba</h1>
        <p className="mt-1 text-center text-sm text-caramba-grafito/55">
          Gestión de regalos corporativos
        </p>
        <form action={loginAction} className="mt-6 space-y-4">
          <Field label="Contraseña" htmlFor="password">
            <Input id="password" name="password" type="password" required autoFocus />
          </Field>
          {error === "rate" ? (
            <p className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-sm text-caramba-amarillo-texto">
              Demasiados intentos. Espera 15 minutos.
            </p>
          ) : error ? (
            <p className="rounded-xl bg-caramba-rojo-soft px-4 py-2.5 text-sm text-caramba-rojo-texto">
              Contraseña incorrecta.
            </p>
          ) : null}
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </Card>
    </main>
  );
}
