import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brazilInputValue } from "@/lib/dates";
import { FormularioCampanha } from "../formulario";
import { opcoesDaCampanha } from "../opcoes";

export const metadata: Metadata = { title: "Nova campanha — Indica +Risos" };

export default async function NovaCampanhaPage() {
  const opcoes = await opcoesDaCampanha();
  // Só quem pode criar: a rede (franqueadora) ou o gestor de alguma unidade.
  if (!opcoes.franqueadora && opcoes.unidades.length === 0) redirect("/indica-mais-risos/campanhas");
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova campanha</h1>
        <p className="text-sm text-muted-foreground">
          Nasce como rascunho: nada muda para os Embaixadores até você publicar.
        </p>
      </div>
      <FormularioCampanha opcoes={opcoes} agoraInput={brazilInputValue(new Date())} />
    </div>
  );
}
