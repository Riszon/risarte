import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { EnvironmentBanner } from "@/components/environment-banner";
import { isTreino } from "@/lib/environment";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// No treino, o nome da aba também muda. Quem trabalha com as duas abas abertas
// escolhe pela aba, não pela tela — e aí a faixa de aviso ainda não apareceu.
const NOME = isTreino() ? "TREINO · Risarte" : "Risarte Odontologia";

export const metadata: Metadata = {
  title: { default: NOME, template: `%s | ${NOME}` },
  description: "Sistema de gestão da jornada do cliente Risarte Odontologia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <EnvironmentBanner />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
