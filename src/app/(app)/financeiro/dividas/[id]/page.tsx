import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { valorDevido } from "@/lib/finance/dividas";
import { podeExcluirDividas, podeLancarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import {
  COLUNAS_DA_DIVIDA,
  carregarBase,
  carregarDetalheDaFase2,
  carregarResumoDaFase2,
  dividaDaLinha,
  linhasDaLista,
  prazosDosSelos,
} from "../dados";
import { DetalheDaDivida } from "./detalhe-da-divida";

/**
 * O detalhe de uma dívida: Dados · Restrições · Propostas · Contatos ·
 * Anexos · Histórico (0404 + 0405).
 */
export default async function DividaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const { id } = await params;
  const { aba } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [base, { data }] = await Promise.all([
    carregarBase(),
    supabase.from("debts").select(`${COLUNAS_DA_DIVIDA}, deleted_at, deleted_reason`).eq("id", id).maybeSingle(),
  ]);
  if (!data) notFound();
  const linha = data as unknown as Record<string, unknown>;
  const divida = dividaDaLinha(linha);

  // O grupo inteiro (para o valor da proposta do grupo e o rateio dos selos).
  const { data: doGrupo } = divida.groupId
    ? await supabase.from("debts").select(COLUNAS_DA_DIVIDA).eq("group_id", divida.groupId).is("deleted_at", null)
    : { data: null };
  const dividasDoGrupo = ((doGrupo ?? []) as unknown as Record<string, unknown>[]).map(dividaDaLinha);
  const [fase2, resumo] = await Promise.all([carregarDetalheDaFase2(divida.id, divida.groupId), carregarResumoDaFase2()]);
  const linhaDaLista = linhasDaLista(dividasDoGrupo.length ? dividasDoGrupo : [divida], base, resumo).find((l) => l.id === divida.id)
    ?? linhasDaLista([divida], base, resumo)[0];

  const pessoas = [
    divida.createdBy,
    divida.updatedBy,
    divida.ownerUserId,
    ...fase2.contatos.map((c) => c.userId),
    ...fase2.anexos.map((a) => a.uploadedBy),
  ].filter((x): x is string => !!x);
  const { data: perfis } = pessoas.length
    ? await supabase.from("profiles").select("id, full_name").in("id", [...new Set(pessoas)])
    : { data: [] as { id: string; full_name: string }[] };
  const nomes = Object.fromEntries(((perfis ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <Link href="/financeiro/dividas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Levantamento de Dívidas
      </Link>
      <DetalheDaDivida
        base={base}
        divida={divida}
        linha={linhaDaLista}
        fase2={fase2}
        devidoDoGrupoCents={dividasDoGrupo.length ? dividasDoGrupo.reduce((a, d) => a + valorDevido(d), 0) : null}
        prazos={prazosDosSelos(base)}
        abaInicial={aba ?? null}
        excluida={linha.deleted_at ? { em: String(linha.deleted_at), motivo: String(linha.deleted_reason ?? "") } : null}
        nomes={nomes}
        hoje={todayInBrazil()}
        podeLancar={podeLancarDividas(session)}
        podeExcluir={podeExcluirDividas(session)}
      />
    </div>
  );
}
