import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewStock } from "@/lib/stock-access";
import { PainelDoRelogio } from "./relogio";
import { Alertas, type Alerta } from "./lista";

export const metadata: Metadata = { title: "Alertas do sistema" };

/**
 * ALERTAS DO SISTEMA — o que o sistema está avisando agora.
 *
 * ⚠️ SEPARADA DE `/problemas` POR ORDEM DO DONO (08/09/2026). As duas moravam
 * na mesma tela `/sistema`, em abas, e os dois ícones da barra de cima abriam
 * a MESMA página mudando só qual aba vinha selecionada. Quem clicava em
 * "Alertas" encontrava "Relatar um problema" do lado — *"dá impressão de
 * gambiarra"*, e dava mesmo: ícone específico que leva a lugar genérico ensina
 * a pessoa a desconfiar do que ela clicou.
 *
 * **Não voltar a juntar.** As duas respondem perguntas opostas: aqui é o
 * SISTEMA falando com a pessoa; lá é a pessoa falando com quem mantém o
 * sistema. Só o que elas têm em comum é serem sobre o sistema — e isso não é
 * critério de tela, é critério de assunto.
 *
 * O painel do relógio mora AQUI, e não em Problemas: um relógio fora de hora é
 * o sistema avisando que algo não bate, não alguém relatando defeito. Foi
 * exatamente assim que ele nasceu, em 05/09/2026.
 */
export default async function AlertasPage() {
  const session = await getSessionContext();
  if (!pode(session, "menu.sistema")) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  // ⚠️ NENHUMA PORTA NOVA. Os alertas vêm das mesmas fontes que já existem,
  // com as guardas que já existem: `finance_alerts` tem RLS por clínica com
  // financeiro visível, e as funções de estoque já checam papel. Criar aqui uma
  // consulta própria seria abrir uma segunda régua para o mesmo dado — e é
  // exatamente assim que uma delas fica desatualizada e vaza (lição da 0227).
  const alertas: Alerta[] = [];

  const { data: financeiros } = await supabase
    .from("finance_alerts")
    .select("rule, reference, detail, amount_cents, first_seen_at, clinics ( name )")
    .is("cleared_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(100);

  for (const a of (financeiros ?? []) as unknown as AlertaFinanceiro[]) {
    alertas.push({
      origem: "Financeiro",
      gravidade: a.rule === "caixa" ? "alta" : "media",
      titulo: ROTULO_REGRA[a.rule] ?? a.rule,
      detalhe: a.detail ?? a.reference,
      valorCentavos: a.amount_cents,
      unidade: a.clinics?.name ?? null,
      desde: a.first_seen_at,
      onde: "/financeiro",
    });
  }

  if (clinicId && canViewStock(session, clinicId)) {
    const [semKit, acabando, excesso] = await Promise.all([
      supabase.rpc("sessions_without_kit", { p_clinic_id: clinicId, p_days: 30 }),
      supabase.rpc("packages_running_out", {
        p_clinic_id: clinicId,
        // O mesmo 15% que a tela de Estoque usa — dois limites diferentes
        // fariam o alerta aparecer aqui e não lá, sem explicação nenhuma.
        p_threshold_percent: 15,
      }),
      supabase.rpc("overstocked_items", { p_clinic_id: clinicId }),
    ]);

    const contarSemKit = (semKit.data ?? []).length;
    if (contarSemKit > 0) {
      alertas.push({
        origem: "Estoque",
        gravidade: "media",
        titulo: "Sessões concluídas sem kit cadastrado",
        detalhe: `${contarSemKit} nos últimos 30 dias — o material saiu da gaveta e não saiu do saldo.`,
        valorCentavos: null,
        unidade: session.activeClinic?.name ?? null,
        desde: null,
        onde: "/estoque",
      });
    }

    const contarAcabando = (acabando.data ?? []).length;
    if (contarAcabando > 0) {
      alertas.push({
        origem: "Estoque",
        gravidade: "baixa",
        titulo: "Embalagens abertas chegando ao fim",
        detalhe: `${contarAcabando} ${contarAcabando === 1 ? "item" : "itens"} — pela estimativa, quase no fim.`,
        valorCentavos: null,
        unidade: session.activeClinic?.name ?? null,
        desde: null,
        onde: "/estoque",
      });
    }

    const contarExcesso = (excesso.data ?? []).length;
    if (contarExcesso > 0) {
      alertas.push({
        origem: "Estoque",
        gravidade: "baixa",
        titulo: "Itens acima do máximo",
        detalhe: `${contarExcesso} ${contarExcesso === 1 ? "item" : "itens"} — é dinheiro parado, e perda programada no que tem validade.`,
        valorCentavos: null,
        unidade: session.activeClinic?.name ?? null,
        desde: null,
        onde: "/estoque",
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Alertas do sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que o Financeiro e o Estoque estão avisando, reunidos num lugar só.
        </p>
      </header>

      <PainelDoRelogio
        servidorIso={new Date().toISOString()}
        fusoDoServidor={
          Intl.DateTimeFormat().resolvedOptions().timeZone || "desconhecido"
        }
      />

      <Alertas alertas={alertas} podeVerEstoque={Boolean(clinicId)} />
    </div>
  );
}

const ROTULO_REGRA: Record<string, string> = {
  orcamento: "Orçamento perto do limite",
  caixa: "Caixa projetado negativo",
  equilibrio: "Faturamento atrás do ponto de equilíbrio",
  atraso: "Atraso acumulado acima do limite",
};

type AlertaFinanceiro = {
  rule: string;
  reference: string;
  detail: string | null;
  amount_cents: number | null;
  first_seen_at: string;
  clinics: { name: string } | null;
};
