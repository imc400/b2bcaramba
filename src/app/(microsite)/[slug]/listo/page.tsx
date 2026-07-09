import Link from "next/link";
import { redirect } from "next/navigation";
import { ToyIcon } from "@/components/brand";
import { getMicrositeSession } from "@/lib/auth/session";
import { getRemainingQuota } from "@/lib/orders";

export default async function ListoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { slug } = await params;
  const { code } = await searchParams;
  const session = await getMicrositeSession();
  if (!session || session.company.slug !== slug) redirect(`/${slug}`);

  const remaining = await getRemainingQuota(session.collaborator.id);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="relative">
        <span
          aria-hidden
          className="absolute -inset-8 -z-10 rounded-full bg-caramba-verde-soft blur-2xl"
        />
        <span className="flex size-20 animate-pop-in items-center justify-center rounded-full bg-caramba-verde shadow-lg shadow-caramba-verde/40">
          <svg
            viewBox="0 0 24 24"
            className="size-10 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path
              d="M5 13l4 4L19 7"
              strokeDasharray="24"
              strokeDashoffset="24"
              style={{ animation: "check-draw 0.45s 0.3s ease-out forwards" }}
            />
          </svg>
        </span>
      </div>

      <h1 className="mt-7 font-display text-3xl text-caramba-grafito">¡Pedido enviado!</h1>

      {code ? (
        <>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/65">
            Tu código de pedido
          </p>
          <p className="mt-1.5 rounded-full bg-caramba-crema px-5 py-2 font-display text-base text-caramba-grafito">
            {code}
          </p>
          <p className="mt-1.5 text-xs text-caramba-grafito/65">
            Guárdalo para cualquier consulta.
          </p>
        </>
      ) : null}

      {/* Qué viene ahora */}
      <div className="mt-8 w-full rounded-2xl border border-caramba-grafito/8 bg-white p-6 text-left shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/65">
          ¿Qué viene ahora?
        </p>
        <ol className="mt-3 space-y-3">
          {[
            "El equipo de Caramba prepara tu pedido con cariño.",
            "Te avisamos por correo cuando vaya en camino.",
            "Llega a la dirección que nos diste. ¡A jugar!",
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm text-caramba-grafito/80">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-caramba-verde-soft text-xs font-bold text-caramba-verde-texto">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-8 flex items-center gap-5">
        {["beach-ball", "robot", "rattle"].map((icon, i) => (
          <span
            key={icon}
            className="animate-pop-in"
            style={{ animationDelay: `${200 + i * 120}ms` }}
          >
            <ToyIcon name={icon} className="size-9" />
          </span>
        ))}
      </div>

      {remaining > 0 ? (
        <Link
          href={`/${slug}/tienda`}
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-caramba-rojo px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#b85543] hover:shadow-md"
        >
          Te queda{remaining === 1 ? "" : "n"} {remaining} regalo{remaining === 1 ? "" : "s"} por
          elegir →
        </Link>
      ) : (
        <Link
          href={`/${slug}/tienda`}
          className="mt-8 text-sm font-semibold text-caramba-grafito/65 hover:text-caramba-grafito"
        >
          ← Volver a la tienda
        </Link>
      )}
    </main>
  );
}
