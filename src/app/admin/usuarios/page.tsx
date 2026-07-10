import { asc } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { AdminShell } from "@/components/admin-shell";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { InviteForm, UserRow } from "./user-list";

export default async function UsuariosPage() {
  const actor = await requireAdmin();
  const usuarios = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
  const esOwner = actor.role === "owner";

  return (
    <AdminShell active="/admin/usuarios" usuario={actor} title="Usuarios del panel">
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          {esOwner ? (
            <InviteForm />
          ) : (
            <Card className="flex items-start gap-3 p-6">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-caramba-verde-texto" strokeWidth={1.8} />
              <p className="text-sm text-caramba-grafito/70">
                Solo el propietario de la cuenta puede invitar o revocar personas del panel.
              </p>
            </Card>
          )}
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-caramba-grafito/8 px-6 py-4">
            <h2 className="font-display text-base text-caramba-grafito">
              {usuarios.filter((u) => u.active).length} con acceso
            </h2>
          </div>
          <ul>
            {usuarios.map((u) => (
              <UserRow
                key={u.id}
                usuario={{
                  id: u.id,
                  email: u.email,
                  name: u.name,
                  role: u.role,
                  active: u.active,
                  entroAlgunaVez: u.lastLoginAt !== null,
                  ultimoAcceso: u.lastLoginAt
                    ? u.lastLoginAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })
                    : null,
                }}
                esYo={u.id === actor.id}
                puedeGestionar={esOwner}
              />
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-caramba-verde-soft px-5 py-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-caramba-verde-texto" strokeWidth={1.8} />
        <p className="text-sm text-caramba-verde-texto">
          <b>Los colaboradores de las empresas no necesitan cuenta aquí.</b> Se invitan desde
          Colaboradores, subiendo el Excel de su empresa, y entran a su link con un código que les
          llega por correo.
        </p>
      </div>
    </AdminShell>
  );
}
