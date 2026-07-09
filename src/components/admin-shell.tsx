import { Building2, Package, Settings, ToyBrick, Users } from "lucide-react";
import Link from "next/link";
import { CarambaLogo } from "./brand";

const NAV = [
  { href: "/admin/pedidos", label: "Pedidos", Icon: Package },
  { href: "/admin/empresas", label: "Empresas", Icon: Building2 },
  { href: "/admin/colaboradores", label: "Colaboradores", Icon: Users },
  { href: "/admin/productos", label: "Productos", Icon: ToyBrick },
  { href: "/admin/ajustes", label: "Ajustes", Icon: Settings },
];

/** Shell del panel: sidebar verde bosque (mockup de la propuesta) + header. */
export function AdminShell({
  active,
  children,
  title,
  actions,
}: {
  active: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-caramba-crema">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col bg-[#22312a] text-white">
        <div className="px-5 py-6">
          <CarambaLogo color="blanco" className="h-9 w-auto" />
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => {
            const isActive = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/12 text-white"
                    : "text-white/60 hover:bg-white/6 hover:text-white"
                }`}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-caramba-amarillo"
                  />
                ) : null}
                <item.Icon
                  aria-hidden
                  className={`size-4.5 shrink-0 ${isActive ? "text-caramba-amarillo" : ""}`}
                  strokeWidth={1.8}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-xs text-white/40">app.caramba.cl</p>
        </div>
      </aside>
      <div className="ml-56 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-caramba-grafito/8 bg-white px-8">
          <h1 className="font-display text-lg text-caramba-grafito">{title}</h1>
          <div className="flex items-center gap-3">{actions}</div>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}

/** Tile de estadística para dashboards (estilo mockup propuesta). */
export function StatCard({
  value,
  label,
  tone = "neutro",
  icon: Icon,
}: {
  value: string | number;
  label: string;
  tone?: "neutro" | "amarillo" | "verde" | "rojo";
  icon?: typeof Package;
}) {
  const tones = {
    neutro: { text: "text-caramba-grafito", chip: "bg-caramba-crema text-caramba-grafito/60" },
    amarillo: {
      text: "text-caramba-amarillo-texto",
      chip: "bg-caramba-amarillo-soft text-caramba-amarillo-texto",
    },
    verde: {
      text: "text-caramba-verde-texto",
      chip: "bg-caramba-verde-soft text-caramba-verde-texto",
    },
    rojo: { text: "text-caramba-rojo-texto", chip: "bg-caramba-rojo-soft text-caramba-rojo-texto" },
  };
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-caramba-grafito/8 bg-white px-6 py-5 shadow-sm transition-shadow hover:shadow-md">
      {Icon ? (
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tones[tone].chip}`}
        >
          <Icon className="size-5" strokeWidth={1.8} aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className={`font-display text-3xl tabular-nums ${tones[tone].text}`}>{value}</p>
        <p className="mt-0.5 text-sm text-caramba-grafito/60">{label}</p>
      </div>
    </div>
  );
}
