import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { isAsaasConfigured } from "@/lib/empresarial/asaas";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil } from "@/lib/dates";
import {
  BILLING_STATUS_LABELS,
  type BillingStatus,
  type BillingType,
} from "@/lib/empresarial/constants";
import { TabelaDeCobrancas, type LinhaDeCobranca } from "./cobrancas-client";

export const metadata: Metadata = { title: "Cobranças do programa" };

/**
 * TODAS AS COBRANÇAS DO PROGRAMA, NUMA TELA SÓ.
 *
 * ⚠️ NASCEU DE UM RELATO (OC-00004, 08/09/2026): *"a visualização em uma única
 * tela otimiza o processo… hoje temos que abrir o financeiro de cada empresa"*.
 * Estava certo — as cinco leituras da tabela de cobrança viviam todas sob
 * `/empresarial/[companyId]`, e não havia nenhuma visão da rede.
 *
 * E não era o sistema fazendo o combinado: a Fase 7 do briefing previa
 * *"painéis por empresa, unidade e CONSOLIDADO; filtros por período/empresa"* e
 * relatórios. O painel entregue tinha empresas, funil, colaboradores e
 * economia, e nenhuma dimensão financeira. Faltava metade da fase.
 *
 * ⚠️ E A TELA NÃO DIZ "BOLETO", DE PROPÓSITO. Quem relatou pediu para
 * "visualizar, imprimir e dar baixa nos boletos" — mas **o sistema não emite
 * boleto**. `createAsaasCharge` existe no código e nunca é chamada; a geração
 * só grava a linha da cobrança. Chamar isto de boleto faria a tela prometer um
 * documento que não existe, e alguém iria procurar o botão de imprimir. O
 * aviso no alto declara isso em vez de esconder.
 */

const STATUS_FILTRO = ["", "PENDING", "OVERDUE", "PAID", "CANCELLED"] as const;

/** O mês de referência é o 1º dia do mês; o filtro de período usa o VENCIMENTO. */
function periodoPadrao(): { de: string; ate: string } {
  const hoje = todayInBrazil();
  const [ano] = hoje.split("-").map(Number);
  return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
}

type LinhaBruta = {
  id: string;
  company_id: string;
  billing_type: BillingType;
  reference_month: string | null;
  total_amount_cents: number;
  status: BillingStatus;
  due_date: string | null;
  paid_at: string | null;
  description: string | null;
  companies: { legal_name: string; trade_name: string | null } | null;
};

export default async function CobrancasPage(
  props: PageProps<"/empresarial/cobrancas">
) {
  const session = await getSessionContext();
  // ⚠️ `notFound()`, não `redirect`: é assim que o resto do sistema recusa
  // acesso, e a varredura de telas conhece essa forma. Só quem gere o programa
  // enxerga a rede inteira — a unidade vê as empresas dela pela ficha.
  if (!isProgramManager(session)) notFound();

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const padrao = periodoPadrao();
  const status = (pick("situacao") ?? "") as (typeof STATUS_FILTRO)[number];
  const de = pick("de") || padrao.de;
  const ate = pick("ate") || padrao.ate;
  const busca = (pick("busca") ?? "").trim();

  const db = await empresarialDb();

  // Uma consulta só, com os filtros no BANCO. Trazer tudo e filtrar na tela
  // funcionaria com três empresas e não funcionaria com duzentas.
  let q = db
    .from("adhesion_billing")
    .select(
      "id, company_id, billing_type, reference_month, total_amount_cents, status, due_date, paid_at, description, companies ( legal_name, trade_name )"
    )
    .order("due_date", { ascending: true, nullsFirst: false });

  if (status) q = q.eq("status", status);
  if (de) q = q.gte("due_date", de);
  if (ate) q = q.lte("due_date", ate);

  const { data } = await q.returns<LinhaBruta[]>();

  const todas: LinhaDeCobranca[] = (data ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    empresa: r.companies?.trade_name || r.companies?.legal_name || "—",
    tipo: r.billing_type,
    mesReferencia: r.reference_month,
    totalCents: Number(r.total_amount_cents ?? 0),
    status: r.status,
    vencimento: r.due_date,
    pagoEm: r.paid_at,
    descricao: r.description,
  }));

  // A busca por nome fica na memória de propósito: ela roda sobre o resultado
  // já filtrado por período e situação, que é pequeno, e evita um `ilike` sobre
  // a tabela inteira a cada tecla.
  const linhas = busca
    ? todas.filter((l) =>
        l.empresa.toLowerCase().includes(busca.toLowerCase())
      )
    : todas;

  // ⚠️ OS TOTAIS SÃO DO QUE ESTÁ NA TELA, e o rodapé diz isso. Somar a base
  // inteira embaixo de uma lista filtrada faria o número não bater com as
  // linhas que a pessoa está vendo — e ela confere somando com o dedo.
  const somaDe = (f: (l: LinhaDeCobranca) => boolean) =>
    linhas.filter(f).reduce((s, l) => s + l.totalCents, 0);

  const hoje = todayInBrazil();
  const emAberto = (l: LinhaDeCobranca) =>
    l.status === "PENDING" || l.status === "OVERDUE";
  // Vencido é o que passou da data E não foi pago — a situação "OVERDUE" só
  // existe depois que alguém roda a checagem de inadimplência, então contar só
  // por ela mostraria menos atraso do que existe.
  const vencida = (l: LinhaDeCobranca) =>
    emAberto(l) && !!l.vencimento && l.vencimento < hoje;

  const resumo = [
    { rotulo: "Em aberto", valor: somaDe(emAberto), n: linhas.filter(emAberto).length },
    { rotulo: "Vencidas", valor: somaDe(vencida), n: linhas.filter(vencida).length },
    {
      rotulo: "Pagas",
      valor: somaDe((l) => l.status === "PAID"),
      n: linhas.filter((l) => l.status === "PAID").length,
    },
    { rotulo: "Cobranças na tela", valor: null, n: linhas.length },
  ];

  // As empresas ativas, para o gerador de mensalidade em lote.
  const { data: empresas } = await db
    .from("companies")
    .select("id, legal_name, trade_name, status")
    .eq("status", "ACTIVE")
    .order("legal_name")
    .returns<
      { id: string; legal_name: string; trade_name: string | null; status: string }[]
    >();

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={Receipt}
        titulo="Cobranças do programa"
        descricao="Todas as empresas numa tela: ver, gerar, dar baixa e conferir o que está vencido."
        voltar={{ href: "/empresarial", rotulo: "Empresas" }}
      />

      {/* ⚠️ O AVISO VEM ANTES DA LISTA, não num rodapé. Quem abre esta tela veio
          procurar boleto; descobrir só no fim que ele não existe é pior do que
          ler no começo. Ver o comentário no alto do arquivo. */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm leading-relaxed">
        <p>
          <strong className="text-foreground">
            Estas são as cobranças do programa, não boletos.
          </strong>{" "}
          O sistema registra o valor, o vencimento e o pagador, e a baixa é{" "}
          <strong className="text-foreground">manual</strong>.
        </p>
        <p className="mt-2 border-t border-gold/30 pt-2 text-muted-foreground">
          {isAsaasConfigured()
            ? "A chave do ASAAS está configurada, mas a emissão automática ainda não foi ligada: nenhuma cobrança daqui vira boleto sozinha."
            : "A emissão de boleto pelo ASAAS ainda não foi ligada. Quando for, o link do boleto aparece nesta mesma tela."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {resumo.map((k) => (
          <Card key={k.rotulo}>
            <CardContent className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {k.rotulo}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {k.valor === null ? k.n : formatBRL(k.valor)}
              </p>
              {k.valor !== null && (
                <p className="text-xs text-muted-foreground">
                  {k.n} cobrança(s)
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <FilterForm className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Situação</span>
          <select
            name="situacao"
            defaultValue={status}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Todas</option>
            {STATUS_FILTRO.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {BILLING_STATUS_LABELS[s as BillingStatus]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Vence de</span>
          <Input type="date" name="de" defaultValue={de} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">até</span>
          <Input type="date" name="ate" defaultValue={ate} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Empresa</span>
          <Input name="busca" defaultValue={busca} placeholder="Nome da empresa" />
        </label>
      </FilterForm>

      <TabelaDeCobrancas
        linhas={linhas}
        empresas={(empresas ?? []).map((c) => ({
          id: c.id,
          nome: c.trade_name || c.legal_name,
        }))}
        hoje={hoje}
      />
    </div>
  );
}
