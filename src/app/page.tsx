import Link from "next/link";
import { CarambaLogo } from "@/components/brand";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-caramba-crema px-6 text-center">
      <CarambaLogo className="h-14 w-auto" />
      <h1 className="max-w-md text-2xl text-caramba-grafito">
        Plataforma de regalos corporativos
      </h1>
      <p className="max-w-sm text-sm text-caramba-grafito/60">
        Si tu empresa te invitó a elegir un regalo, usa el link que te compartieron.
      </p>
      <Link
        href="https://caramba.cl"
        className="text-sm font-semibold text-caramba-rojo hover:underline"
      >
        Visitar caramba.cl →
      </Link>
    </main>
  );
}
