import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { EnvironmentBanner } from "@/components/environment-banner";
import { isTreino } from "@/lib/environment";
import { RoteiroDoTema } from "@/components/tema";
import "./globals.css";

/**
 * ⚠️ INTER É ORDEM DO BRANDBOOK, não preferência. Ele nomeia a Inter como "a
 * fonte de interface, dedicada aos ambientes digitais — telas, formulários,
 * aplicativos, sites e SISTEMAS": o nosso caso, com todas as letras.
 *
 * E isso resolve de graça um problema que seria caro. As outras duas fontes do
 * manual são proprietárias — NORD é da Designova ("todos os direitos
 * reservados") e Satoshi é da Indian Type Foundry —, e publicar fonte
 * proprietária num site exige licença de webfont, separada da de desktop. A
 * Inter é SIL Open Font License. Seguir o manual à risca é, aqui, também o
 * caminho legal.
 *
 * A NORD continua na marca: ela está DENTRO da arte da logomarca, em contorno.
 */
const interSans = Inter({
  variable: "--font-inter",
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
      className={`${interSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <RoteiroDoTema />
      </head>
      <body className="min-h-full flex flex-col">
        <EnvironmentBanner />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
