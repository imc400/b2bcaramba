import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Mail, MailCheck, Package } from "lucide-react";
import { CarambaLogo, ToyIcon } from "@/components/brand";

export const metadata: Metadata = {
  title: "Regalos corporativos para empresas",
  description:
    "Invita a tu equipo a elegir su regalo entre los juguetes de Caramba: la empresa define catálogo y cupos, cada colaborador elige y Caramba prepara y despacha. Escríbenos a ventas@caramba.cl.",
};

const MAILTO_VENTAS =
  "mailto:ventas@caramba.cl?subject=Regalos%20corporativos%20para%20mi%20empresa";

const pasos = [
  {
    icon: ListChecks,
    tone: "bg-caramba-verde-soft text-caramba-verde-texto",
    titulo: "La empresa arma la campaña",
    detalle:
      "Define el catálogo de juguetes y los cupos de regalo para su equipo.",
  },
  {
    icon: MailCheck,
    tone: "bg-caramba-amarillo-soft text-caramba-amarillo-texto",
    titulo: "Cada colaborador elige",
    detalle:
      "Entra con su correo al portal de su empresa y elige el regalo que más le guste.",
  },
  {
    icon: Package,
    tone: "bg-caramba-rosa-soft text-caramba-rojo-texto",
    titulo: "Caramba prepara y despacha",
    detalle:
      "Preparamos cada regalo y lo despachamos a la dirección que indique cada persona.",
  },
];

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col bg-caramba-crema">
      {/* Hero: habla a la empresa; los colaboradores tienen su nota al pie */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-16 text-center sm:pt-20">
        <CarambaLogo className="h-14 w-auto" />
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-caramba-rojo-texto">
          Para empresas
        </p>
        <h1 className="mt-3 text-3xl leading-tight text-caramba-grafito sm:text-4xl">
          Regalos corporativos con los juguetes de Caramba
        </h1>
        <p className="mt-4 max-w-xl text-caramba-grafito/70">
          Invita a tu equipo: cada persona elige su regalo y Caramba lo prepara
          y despacha.
        </p>
      </section>

      {/* Cómo funciona */}
      <section className="mx-auto w-full max-w-4xl px-6 pt-14 sm:pt-16">
        <h2 className="text-center text-xl text-caramba-grafito sm:text-2xl">
          Cómo funciona
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-5">
          {pasos.map(({ icon: Icon, tone, titulo, detalle }, i) => (
            <li
              key={titulo}
              className="rounded-2xl border border-caramba-grafito/8 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex size-11 items-center justify-center rounded-full ${tone}`}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/45">
                  Paso {i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base text-caramba-grafito">{titulo}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-caramba-grafito/70">
                {detalle}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA principal */}
      <section className="mx-auto w-full max-w-2xl px-6 pt-12 sm:pt-14">
        <div className="rounded-3xl border border-caramba-grafito/8 bg-white px-6 py-10 text-center shadow-sm sm:px-10">
          <div className="flex items-center justify-center gap-5 opacity-60">
            <ToyIcon name="rocking-horse" className="size-9" />
            <ToyIcon name="teddy-bear" className="size-9" />
            <ToyIcon name="plane" className="size-9" />
          </div>
          <h2 className="mt-5 text-xl text-caramba-grafito sm:text-2xl">
            ¿Quieres sorprender a tu equipo?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-caramba-grafito/70">
            Cuéntanos sobre tu empresa y te preparamos una propuesta a la
            medida.
          </p>
          <a
            href={MAILTO_VENTAS}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-caramba-rojo px-7 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#b85543] hover:shadow-md"
          >
            <Mail className="size-4" aria-hidden />
            Escríbenos
          </a>
          <p className="mt-3 text-xs text-caramba-grafito/55">
            ventas@caramba.cl
          </p>
        </div>
      </section>

      {/* Nota para colaboradores invitados */}
      <footer className="mt-auto pt-14 sm:pt-16">
        <div className="border-t border-caramba-grafito/8 bg-white/60">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-1 px-6 py-8 text-center">
            <p className="text-sm text-caramba-grafito/70">
              ¿Tu empresa ya te invitó? Entra con el link que te compartieron.
            </p>
            <Link
              href="https://caramba.cl"
              className="text-sm font-semibold text-caramba-rojo hover:underline"
            >
              Visitar caramba.cl →
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
