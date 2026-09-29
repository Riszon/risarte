import type { Metadata } from "next";
import { GuiaIndica } from "../guia/guia";

export const metadata: Metadata = { title: "Como funciona — Indica +Risos" };

/** O guia do programa, dentro do módulo (com as abas no topo). */
export default function ComoFuncionaPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Como funciona o Indica +Risos</h1>
        <p className="text-sm text-muted-foreground">
          O guia do programa para toda a equipe. Os números vêm da configuração da rede — mudou lá, muda aqui.
        </p>
      </div>
      <GuiaIndica />
    </div>
  );
}
