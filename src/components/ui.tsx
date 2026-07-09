import { type ComponentProps, type ReactNode } from "react";

/** Design system Caramba — primitivas UI (ver docs/brand-tokens.md) */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-caramba-rojo text-white hover:bg-[#b85543] active:scale-[0.98] shadow-sm hover:shadow-md",
  secondary:
    "bg-white text-caramba-grafito border border-caramba-grafito/15 hover:border-caramba-grafito/40",
  ghost: "bg-transparent text-caramba-grafito hover:bg-caramba-crema",
  success: "bg-caramba-verde text-white hover:bg-[#7bab90] active:scale-[0.98]",
  danger: "bg-white text-caramba-rojo border border-caramba-rojo/30 hover:bg-caramba-rojo-soft",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramba-grafito/40 focus-visible:ring-offset-2",
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Chip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3.5 py-2.5 text-[13px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramba-grafito/40",
        active
          ? "bg-caramba-grafito text-white border-caramba-grafito"
          : "bg-white text-caramba-grafito/80 border-caramba-grafito/15 hover:border-caramba-grafito/40",
        className,
      )}
      {...props}
    />
  );
}

const badgeTones = {
  verde: "bg-caramba-verde-soft text-[#3f7a5c]",
  amarillo: "bg-caramba-amarillo-soft text-[#8a6d1a]",
  rojo: "bg-caramba-rojo-soft text-[#a34433]",
  neutro: "bg-caramba-crema text-caramba-grafito/70",
  grafito: "bg-caramba-grafito text-white",
} as const;

export function Badge({
  tone = "neutro",
  className,
  children,
}: {
  tone?: keyof typeof badgeTones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-2xl border border-caramba-grafito/8 bg-white shadow-sm", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        // text-base evita el auto-zoom de iOS al enfocar inputs <16px
        "w-full rounded-xl border border-caramba-grafito/15 bg-white px-4 py-3 text-base text-caramba-grafito placeholder:text-caramba-grafito/50 outline-none transition-colors focus:border-caramba-verde focus:ring-2 focus:ring-caramba-verde/25",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-xs font-bold uppercase tracking-wider text-caramba-grafito/70",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="mt-1 text-xs text-caramba-grafito/65">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
