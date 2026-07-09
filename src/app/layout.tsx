import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// viewportFit: cover habilita env(safe-area-inset-*) en iPhone (barra fija)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Tipografías oficiales del Brandbook: Capriola (titulares) + Spartan (texto)
const capriola = localFont({
  src: "../fonts/Capriola-Regular.ttf",
  variable: "--font-capriola",
  display: "swap",
});

const spartan = localFont({
  src: "../fonts/Spartan-VariableFont.ttf",
  variable: "--font-spartan",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Caramba — Regalos corporativos",
    template: "%s · Caramba",
  },
  description:
    "Plataforma de regalos corporativos de Caramba. La vida es para jugar.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-CL"
      className={`${capriola.variable} ${spartan.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
