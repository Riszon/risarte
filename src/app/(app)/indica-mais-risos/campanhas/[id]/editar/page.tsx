import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import { campanhaComecou } from "@/lib/indica/campanhas";
import { brazilInputValue } from "@/lib/dates";
import { FormularioCampanha } from "../../formulario";
import { CAMPOS_CAMPANHA, type Campanha } from "../../dados";
import { opcoesDaCampanha } from "../../opcoes";

export const metadata: Metadata = { title: "Editar campanha — Indica +Risos" };

export default async function EditarCampanhaPage({ params }: PageProps<"/indica-mais-risos/campanhas/[id]/editar">) {
  const { id } = await params;
  const session = await getSessionContext();
  const db = await indicaDb();
  const { data: c } = await db.from("campanhas").select(CAMPOS_CAMPANHA).eq("id", id).maybeSingle<Campanha>();
  if (!c) notFound();
  const podeMexer =
    ehFranqueadoraIndica(session) ||
    (c.escopo === "unidades" && c.unidades.length > 0 && c.unidades.every((u) => ehGestorIndica(session, u)));
  if (!podeMexer || c.status === "encerrada" || c.status === "apurada") {
    redirect(`/indica-mais-risos/campanhas/${c.id}`);
  }
  const opcoes = await opcoesDaCampanha();
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Editar: {c.nome}</h1>
      <FormularioCampanha
        opcoes={opcoes}
        agoraInput={brazilInputValue(new Date())}
        inicial={{
          id: c.id,
          nome: c.nome,
          descricao: c.descricao,
          modelo: c.modelo,
          escopo: c.escopo,
          unidades: c.unidades,
          inicioInput: brazilInputValue(c.inicio),
          fimInput: brazilInputValue(c.fim),
          regras: c.regras,
          publico: c.publico,
          especialidade: c.especialidade,
          orcamento_max_centavos: c.orcamento_max_centavos,
          beneficio_indicado: c.beneficio_indicado,
          regulamento_md: c.regulamento_md,
          comecou: campanhaComecou(c.status),
        }}
      />
    </div>
  );
}
