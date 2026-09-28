import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import {
  GRUPO_PREMIO_LABEL,
  METRICA_LABEL,
  PREMIO_TIPO_LABEL,
  totaisDaFolha,
  type Metrica,
  type PremioApurado,
} from "@/lib/indica/metas";
import { ROLE_LABELS } from "@/lib/roles";
import { formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Relatório para a folha — Indica +Risos" };

type Linha = {
  id: string;
  tipo: string;
  valor_apurado: number;
  faixa_atingida: string | null;
  taxa_comparecimento: number | null;
  status: string;
  aprovado_em: string | null;
  premios: PremioApurado[];
  meta: {
    unidade_id: string;
    periodo_inicio: string;
    periodo_fim: string;
    metrica: Metrica;
  } | null;
};

/**
 * Relatório da apuração APROVADA para a folha de pagamento. Decisão do dono
 * (28/09/2026): prêmio em dinheiro NÃO vira conta a pagar até o contador
 * validar — este relatório é o que vai para quem faz a folha.
 */
export default async function RelatorioFolhaPage({ params }: PageProps<"/indica-mais-risos/equipe/apuracao/[id]">) {
  const { id } = await params;
  const db = await indicaDb();
  const { data: a } = await db
    .from("apuracoes")
    .select("id, tipo, valor_apurado, faixa_atingida, taxa_comparecimento, status, aprovado_em, premios, meta:metas_equipe!apuracoes_meta_id_fkey(unidade_id, periodo_inicio, periodo_fim, metrica)")
    .eq("id", id)
    .maybeSingle<Linha>();
  if (!a || !a.meta || a.tipo !== "final") notFound();
  const supabase = await createClient();
  const { data: unidade } = await supabase.from("clinics").select("name").eq("id", a.meta.unidade_id).maybeSingle<{ name: string }>();
  const aprovada = a.status === "aprovada" || a.status === "paga";
  const totais = totaisDaFolha(a.premios ?? []);
  const papel = (f: string) => ROLE_LABELS[f as keyof typeof ROLE_LABELS] ?? f;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 print:py-0">
      <div className="print:hidden">
        <Link href="/indica-mais-risos/equipe" className="text-xs text-muted-foreground hover:underline">← Equipe</Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatório para a folha — Indica +Risos</h1>
        <p className="text-sm text-muted-foreground">
          {unidade?.name ?? "Unidade"} · {METRICA_LABEL[a.meta.metrica]} de {formatIsoDateBr(a.meta.periodo_inicio)} a{" "}
          {formatIsoDateBr(a.meta.periodo_fim)} · apurado {String(Number(a.valor_apurado)).replace(".", ",")} · faixa{" "}
          <strong>{a.faixa_atingida ?? "nenhuma"}</strong> · comparecimento{" "}
          {a.taxa_comparecimento === null ? "—" : `${String(a.taxa_comparecimento).replace(".", ",")}%`}
        </p>
        <p className="text-sm text-muted-foreground">
          {aprovada && a.aprovado_em ? `Aprovada em ${formatBrDateTime(a.aprovado_em)}.` : "Ainda não aprovada — não usar para pagamento."}
        </p>
      </div>

      {!aprovada ? null : (a.premios ?? []).length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhum prêmio: a faixa não foi atingida (ou a trava de qualidade barrou).
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Prêmio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(a.premios ?? []).map((p) => (
                  <TableRow key={`${p.user_id}-${p.funcao}`}>
                    <TableCell className="font-medium">{p.nome || "—"}</TableCell>
                    <TableCell className="text-sm">{papel(p.funcao)}</TableCell>
                    <TableCell className="text-sm">{GRUPO_PREMIO_LABEL[p.grupo]}</TableCell>
                    <TableCell className="text-sm">
                      {p.premio ? PREMIO_TIPO_LABEL[p.premio.tipo] : "—"}
                      {p.premio?.descricao ? <span className="block text-xs text-muted-foreground">{p.premio.descricao}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">{p.premio ? formatBRL(p.premio.valor_centavos) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="rounded-xl border p-4 text-sm">
            <p>Total em dinheiro (folha): <strong>{formatBRL(totais.dinheiroCentavos)}</strong></p>
            <p>Vouchers: {totais.vouchers} ({formatBRL(totais.voucherCentavos)})</p>
            <p>Experiências da equipe: {totais.experiencias}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Prêmio em dinheiro segue para a folha como relatório; nenhum lançamento foi feito no Financeiro
              (aguardando validação do contador sobre o reflexo trabalhista).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
