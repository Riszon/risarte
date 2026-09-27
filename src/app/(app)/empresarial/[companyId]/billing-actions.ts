"use server";

import { decidirImplantacao } from "@/lib/empresarial/implantacao-cobranca";
import { ehValorFixo, implantacaoDoFixo, mensalidadeDoFixo } from "@/lib/empresarial/mensalidade";
import { formatBRL } from "@/lib/pricing";
import { naoConseguiConferir } from "@/lib/contagem";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  computeMonthlyBreakdown,
  implantacaoPeloContratado,
  precoPorTitularDaImplantacao,
} from "@/lib/empresarial/cobranca-servidor";
import { proximoVencimento, rotuloDoMes } from "@/lib/empresarial/vencimento";

export type ActionResult = { ok: boolean; error?: string };

export type BillingPreview = {
  ok: boolean;
  error?: string;
  /** Uma linha por boleto que será gerado (mais de uma no modelo por documento). */
  items?: {
    documentId: string | null;
    payerName: string;
    payerDoc: string;
    employees: number;
    totalCents: number;
  }[];
  dueDate?: string;
  referenceMonth?: string;
  description?: string;
  beneficiary?: string;
  billingModel?: string;
  /** Implantação: o cálculo usou a quantidade contratada, não os cadastrados. */
  baseContratada?: number;
  /** Quantos titulares estão cadastrados agora (para a tela explicar a conta). */
  titularesCadastrados?: number;
  /** Nem titulares nem quantidade contratada: a tela precisa pedir o valor. */
  precisaValor?: boolean;
  /**
   * Implantação de SEGUNDA etapa (AP12): quantos titulares as implantações
   * anteriores já cobriram, e a base de hoje. A cobrança é só a diferença.
   */
  jaCobertos?: number;
  baseDaImplantacao?: number;
  /**
   * Há implantação antiga, gerada antes da 1023, sem o registro de quantos
   * titulares cobriu. A conta sai do jeito de sempre — e a tela avisa, porque
   * pode estar cobrando de novo quem já pagou.
   */
  avisoCobertura?: string;
  /**
   * AP18 (1024): acordo de VALOR FIXO. A mensalidade é o fixo + os termos
   * aceitos; a implantação é o 1º pagamento do que ainda não foi cobrado.
   */
  valorFixo?: {
    fixoCents: number;
    termosCents: number;
    /** Implantação: o que as implantações anteriores já cobraram. */
    jaCobradoCents?: number;
  };
};

/**
 * Prévia do que será cobrado — o dono confirma antes de gerar (valor, vencimento,
 * pagador, beneficiário e a que se refere).
 */
export async function previewBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY"
): Promise<BillingPreview> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select(
      "legal_name, trade_name, cnpj, due_day, billing_model, contracted_holders, billing_basis, fixed_monthly_cents"
    )
    .eq("id", companyId)
    .maybeSingle<{
      legal_name: string;
      trade_name: string | null;
      cnpj: string;
      due_day: number;
      billing_model: string;
      contracted_holders: number | null;
      billing_basis: string | null;
      fixed_monthly_cents: number | null;
    }>();
  if (!company) return { ok: false, error: "Empresa não encontrada." };
  const contratado = company.contracted_holders;

  const { data: docs } = await db
    .from("company_documents")
    .select("id, doc_type, doc_formatted, nickname, is_primary")
    .eq("company_id", companyId)
    .returns<
      {
        id: string;
        doc_type: string;
        doc_formatted: string;
        nickname: string | null;
        is_primary: boolean;
      }[]
    >();
  const perDocument = company.billing_model === "por_cnpj" && (docs?.length ?? 0) > 1;

  const breakdown = await computeMonthlyBreakdown(db, companyId);
  // AP13: sem conseguir ler preço, titulares e dependentes, não há conta — e
  // conta "aproximada" numa cobrança é conta errada com cara de certa.
  if (!breakdown) {
    return { ok: false, error: naoConseguiConferir("o preço e os titulares da empresa") };
  }
  const companyName = company.trade_name || company.legal_name;
  const primary = (docs ?? []).find((d) => d.is_primary);

  const { dueDate, referenceMonth } = proximoVencimento(company.due_day);
  // O rótulo vem do NÚMERO do mês, sem instante no meio (ver rotuloDoMes).
  const monthLabel = rotuloDoMes(referenceMonth);
  const description =
    billingType === "IMPLANTATION"
      ? `Adesão e implantação — Risarte Empresarial (${companyName})`
      : `Mensalidade do Risarte Empresarial — ${monthLabel}`;

  // ⚠️ AP18 (1024): ACORDO DE VALOR FIXO — regras do dono, 27/09/2026.
  //   * mensalidade = o fixo + o que os termos de inclusão ACEITOS somaram
  //     (o termo "novo valor fixo" guarda a diferença: somando, dá o pacote);
  //   * implantação = o 1º pagamento: um mês do fixo, depois só o acréscimo.
  // Um boleto só, no documento principal: o pacote é da empresa, não de CNPJ.
  if (ehValorFixo(company.billing_basis)) {
    const { data: termos, error: erroDosTermos } = await db
      .from("company_inclusion_terms")
      .select("monthly_delta_cents")
      .eq("company_id", companyId)
      .eq("status", "ACEITO")
      .returns<{ monthly_delta_cents: number }[]>();
    if (erroDosTermos || !termos) {
      return { ok: false, error: naoConseguiConferir("os termos de inclusão da empresa") };
    }
    const deltas = termos.map((t) => t.monthly_delta_cents);
    const mensal = mensalidadeDoFixo(company.fixed_monthly_cents, deltas);
    if (mensal === null) {
      return {
        ok: false,
        error: "Esta empresa é de valor fixo, mas o valor fixo mensal não está cadastrado. Nada foi gerado.",
      };
    }
    const fixoCents = company.fixed_monthly_cents ?? 0;
    const pagador = {
      documentId: null,
      payerName: companyName,
      payerDoc: primary ? `${primary.doc_type} ${primary.doc_formatted}` : company.cnpj,
      employees: breakdown.totalEmployees,
    };
    const comum = {
      ok: true as const,
      dueDate,
      referenceMonth,
      beneficiary: "Risarte / RisLife",
      billingModel: company.billing_model,
      titularesCadastrados: breakdown.totalEmployees,
    };

    if (billingType === "MONTHLY") {
      return {
        ...comum,
        items: [{ ...pagador, totalCents: mensal }],
        description,
        valorFixo: { fixoCents, termosCents: mensal - fixoCents },
      };
    }

    const { data: anteriores, error: erroDasAnteriores } = await db
      .from("adhesion_billing")
      .select("total_amount_cents")
      .eq("company_id", companyId)
      .eq("billing_type", "IMPLANTATION")
      .neq("status", "CANCELLED")
      .returns<{ total_amount_cents: number }[]>();
    if (erroDasAnteriores || !anteriores) {
      return { ok: false, error: naoConseguiConferir("as implantações já cobradas desta empresa") };
    }
    const impl = implantacaoDoFixo(mensal, anteriores.map((a) => a.total_amount_cents));
    if (impl.tipo === "nada") {
      return {
        ok: false,
        error: `A implantação desta empresa já foi cobrada (${formatBRL(impl.jaCobradoCents)}, igual à mensalidade de hoje). Não há o que cobrar. Quando um termo de inclusão aumentar o valor, o acréscimo paga a própria implantação.`,
      };
    }
    return {
      ...comum,
      items: [{ ...pagador, totalCents: impl.aCobrarCents }],
      description:
        impl.tipo === "primeira"
          ? description
          : `Implantação do acréscimo do valor fixo — Risarte Empresarial (${companyName})`,
      valorFixo: {
        fixoCents,
        termosCents: mensal - fixoCents,
        jaCobradoCents: impl.tipo === "diferenca" ? impl.jaCobradoCents : 0,
      },
    };
  }

  let items: NonNullable<BillingPreview["items"]>;
  if (perDocument) {
    items = (docs ?? []).map((d) => {
      const part = breakdown.byDocument.get(d.id) ?? { employees: 0, cents: 0 };
      return {
        documentId: d.id,
        payerName: d.nickname ? `${companyName} — ${d.nickname}` : companyName,
        payerDoc: `${d.doc_type} ${d.doc_formatted}`,
        employees: part.employees,
        totalCents: part.cents,
      };
    });
    // Titulares sem documento definido entram no principal.
    const orphan = breakdown.byDocument.get("__none__");
    if (orphan && orphan.cents > 0 && items.length > 0) {
      const target =
        items.find((i) => i.documentId === primary?.id) ?? items[0];
      target.employees += orphan.employees;
      target.totalCents += orphan.cents;
    }
    items = items.filter((i) => i.totalCents > 0);
  } else {
    items = [
      {
        documentId: null,
        payerName: companyName,
        payerDoc: primary
          ? `${primary.doc_type} ${primary.doc_formatted}`
          : company.cnpj,
        employees: breakdown.totalEmployees,
        totalCents: breakdown.totalCents,
      },
    ];
  }

  // ⚠️ A IMPLANTAÇÃO NÃO ESPERA OS CADASTROS (relatos OC-00055 e OC-00057,
  // decisão do dono em 24/09/2026).
  //
  // Antes, sem nenhum titular ativo a geração era recusada — e a empresa que
  // aderiu hoje e só manda os nomes no mês que vem ficava sem como ser
  // cobrada. Pior: quando havia 2 de 7 cadastrados, a cobrança saía pelos 2,
  // e só não saía errada se alguém lembrasse de corrigir o valor na mão.
  //
  // Agora a base é a QUANTIDADE CONTRATADA, que veio da proposta no
  // fechamento (I4). Sem ela, a tela pede o valor — é o caso das empresas
  // cadastradas direto, sem passar pelo funil.
  // ⚠️ CADA TITULAR PAGA IMPLANTAÇÃO UMA VEZ (AP12, regra do dono em
  // 26/09/2026). Antes, a conta começava do zero a cada clique: na segunda
  // etapa (termo de inclusão de +20) cobrava os 100 cadastrados, e os 80 que
  // já tinham pago pagavam de novo — e dois cliques também duplicavam.
  let avisoCobertura: string | undefined;
  if (billingType === "IMPLANTATION") {
    const [
      { data: limiteRow, error: erroDoLimite },
      { data: anteriores, error: erroDasAnteriores },
    ] = await Promise.all([
      // A base é o LIMITE (contratado + termos de inclusão aceitos), não só o
      // contratado: é o termo aceito que diz que a segunda etapa existe.
      db.rpc("limite_de_titulares", { p_company_id: companyId }),
      db
        .from("adhesion_billing")
        .select("holders_covered")
        .eq("company_id", companyId)
        .eq("billing_type", "IMPLANTATION")
        .neq("status", "CANCELLED")
        .returns<{ holders_covered: number | null }[]>(),
    ]);
    // Sem conseguir ler, não se adivinha (AP11): a conta errada aqui é cobrar
    // de novo quem já pagou.
    if (erroDoLimite || erroDasAnteriores || !anteriores) {
      return {
        ok: false,
        error: naoConseguiConferir("quantos titulares já pagaram implantação"),
      };
    }
    const limite =
      typeof limiteRow === "number" ? limiteRow : (limiteRow?.[0] ?? null);
    const decisao = decidirImplantacao({
      limite,
      ativos: breakdown.totalEmployees,
      anteriores,
    });

    if (decisao.tipo === "nada") {
      return {
        ok: false,
        error: `Todos os titulares já pagaram a implantação (${decisao.jaCobertos} cobertos; a base de hoje é de ${decisao.base}). Não há o que cobrar. Quando entrarem titulares novos, eles pagam a própria implantação.`,
      };
    }

    if (decisao.tipo === "diferenca") {
      // A FAIXA É A DA EMPRESA INTEIRA (a base), não a dos novos: os 20 que
      // entram numa empresa de 100 pagam o preço de 100 — pagar a faixa de 20
      // cobraria mais caro justamente de quem entrou depois. É a mesma lei da
      // primeira etapa, escrita em `implantacaoPeloContratado`.
      const porTitular = await precoPorTitularDaImplantacao(db, companyId, decisao.base);
      if (porTitular === null) {
        return { ok: false, error: naoConseguiConferir("o preço da adesão") };
      }
      return {
        ok: true,
        items: [
          {
            documentId: null,
            payerName: companyName,
            payerDoc: primary
              ? `${primary.doc_type} ${primary.doc_formatted}`
              : company.cnpj,
            employees: decisao.aCobrar,
            totalCents: porTitular * decisao.aCobrar,
          },
        ],
        dueDate,
        referenceMonth,
        description: `Implantação dos novos titulares (${decisao.aCobrar}) — Risarte Empresarial (${companyName})`,
        beneficiary: "Risarte / RisLife",
        billingModel: company.billing_model,
        jaCobertos: decisao.jaCobertos,
        baseDaImplantacao: decisao.base,
        titularesCadastrados: breakdown.totalEmployees,
      };
    }

    if (decisao.tipo === "desconhecido") {
      avisoCobertura = `Esta empresa tem ${decisao.semRegistro} implantação(ões) gerada(s) antes do registro de quantos titulares cada uma cobriu. A conta abaixo é a de sempre e PODE estar cobrando de novo quem já pagou — confira e use Editar para acertar o valor.`;
    }
  }

  if (billingType === "IMPLANTATION") {
    const semTitulares = breakdown.totalEmployees === 0;
    const menosQueOContratado =
      contratado != null && breakdown.totalEmployees < contratado;

    if (semTitulares || menosQueOContratado) {
      if (contratado != null && contratado > 0) {
        const cents = await implantacaoPeloContratado(db, companyId, contratado);
        if (cents === null) {
          return { ok: false, error: naoConseguiConferir("o preço da adesão") };
        }
        return {
          ok: true,
          items: [
            {
              documentId: null,
              payerName: companyName,
              payerDoc: primary
                ? `${primary.doc_type} ${primary.doc_formatted}`
                : company.cnpj,
              employees: contratado,
              totalCents: cents,
            },
          ],
          dueDate,
          referenceMonth,
          description,
          beneficiary: "Risarte / RisLife",
          billingModel: company.billing_model,
          baseContratada: contratado,
          titularesCadastrados: breakdown.totalEmployees,
          avisoCobertura,
        };
      }
      if (semTitulares) {
        // Sem titulares E sem quantidade contratada: ninguém tem como saber o
        // valor. A tela pergunta — inventar um número aqui seria pior.
        return {
          ok: true,
          items: [
            {
              documentId: null,
              payerName: companyName,
              payerDoc: primary
                ? `${primary.doc_type} ${primary.doc_formatted}`
                : company.cnpj,
              employees: 0,
              totalCents: 0,
            },
          ],
          dueDate,
          referenceMonth,
          description,
          beneficiary: "Risarte / RisLife",
          billingModel: company.billing_model,
          precisaValor: true,
          titularesCadastrados: 0,
          avisoCobertura,
        };
      }
    }
  }

  if (items.length === 0 || items.every((i) => i.totalCents <= 0)) {
    return {
      ok: false,
      error:
        billingType === "MONTHLY"
          ? "Sem titulares ativos para cobrar a mensalidade. Complete os cadastros antes."
          : "Sem titulares ativos e sem quantidade contratada. Informe o valor da implantação.",
    };
  }

  return {
    ok: true,
    items,
    dueDate,
    referenceMonth,
    description,
    beneficiary: "Risarte / RisLife",
    billingModel: perDocument ? "por_cnpj" : "unico",
    avisoCobertura,
  };
}

/** Vencimento: próximo dia configurado que ainda não passou. */
// ⚠️ A CONTA DO VENCIMENTO SAIU DAQUI (achado AP1, corrigido em 25/09/2026).
//
// Ela vivia nesta função privada e lia o calendário do SERVIDOR — que na
// Vercel é UTC. Entre 21h e meia-noite de Brasília o servidor já está no dia
// seguinte, e uma cobrança gerada às 22h do dia 30 gravava o mês de
// referência do mês seguinte. E `new Date(2026, 1, 31)` é 3 de MARÇO: a
// empresa com vencimento no dia 31 recebia, em fevereiro, um boleto para
// março.
//
// Agora mora em `@/lib/empresarial/vencimento`, pura e com teste — porque
// decide data e dinheiro, e os dois defeitos eram invisíveis para quem olha a
// tela num computador brasileiro.

/** Gera a cobrança (implantação ou mensal). Cria o registro local (PENDING). */
export async function generateBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY",
  /**
   * Valor informado à mão, em centavos. Só vale para a IMPLANTAÇÃO e só quando
   * a prévia disse que não há como calcular (`precisaValor`) — a empresa não
   * tem titulares nem quantidade contratada. Aceitá-lo em qualquer caso abriria
   * a porta para alguém digitar um valor por cima da conta sem ninguém ver.
   */
  valorInformadoCents?: number
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  // A prévia é a mesma que o usuário confirmou na tela (um ou vários boletos).
  const preview = await previewBilling(companyId, billingType);
  if (!preview.ok || !preview.items) {
    return { ok: false, error: preview.error ?? "Não foi possível gerar." };
  }

  if (preview.precisaValor) {
    if (!valorInformadoCents || valorInformadoCents <= 0) {
      return { ok: false, error: "Informe o valor da implantação." };
    }
    preview.items = preview.items.map((i) => ({
      ...i,
      totalCents: valorInformadoCents,
    }));
  }

  const db = await empresarialDb();

  // ⚠️ A MENSALIDADE DO MÊS JÁ FOI GERADA? (1022)
  // Até 26/09/2026 esta tela não conferia: o botão só ficava bloqueado
  // enquanto carregava, e dois cliques — ou um aqui e outro no lote —
  // cobravam a empresa em dobro. A trava de verdade agora está no BANCO; esta
  // conferência existe para a pessoa ouvir o PORQUÊ, antes de tentar.
  //
  // A chave é a mesma do banco: (empresa, DOCUMENTO, mês). Empresa com dois
  // CNPJs recebe dois boletos no mês, e isso é legítimo.
  if (billingType === "MONTHLY") {
    // Sem o mês, não há o que conferir — e gerar sem conferir é exatamente o
    // que esta trava existe para impedir.
    if (!preview.referenceMonth) {
      return { ok: false, error: naoConseguiConferir("o mês de referência da mensalidade") };
    }
    const { data: jaGeradas, error: erroDaConferencia } = await db
      .from("adhesion_billing")
      .select("company_document_id")
      .eq("company_id", companyId)
      .eq("billing_type", "MONTHLY")
      .eq("reference_month", preview.referenceMonth)
      .neq("status", "CANCELLED");
    // Sem conseguir conferir, NÃO gera (AP11): a trava do banco seguraria a
    // duplicata, mas a pessoa receberia um erro sem explicação.
    if (erroDaConferencia || !jaGeradas) {
      return { ok: false, error: naoConseguiConferir("se a mensalidade deste mês já foi gerada") };
    }
    const docsJaCobrados = new Set(jaGeradas.map((r) => r.company_document_id ?? null));
    if (preview.items.some((i) => docsJaCobrados.has(i.documentId ?? null))) {
      return {
        ok: false,
        error: `A mensalidade de ${rotuloDoMes(preview.referenceMonth)} desta empresa já foi gerada. Para refazê-la, cancele a atual primeiro.`,
      };
    }
  }

  const rows = preview.items.map((i) => ({
    company_id: companyId,
    company_document_id: i.documentId,
    billing_type: billingType,
    reference_month: preview.referenceMonth,
    total_amount_cents: i.totalCents,
    status: "PENDING",
    due_date: preview.dueDate,
    description: preview.description,
    // AP12: é isto que a PRÓXIMA implantação desconta. Quando o valor foi
    // informado à mão (sem titulares e sem contrato), não se sabe quantos ele
    // cobriu — fica nulo ("não sei"), e a próxima prévia avisa.
    holders_covered:
      billingType === "IMPLANTATION" && !preview.precisaValor ? i.employees : null,
  }));

  const { error } = await db.from("adhesion_billing").insert(rows);
  if (error) {
    // 23505 = a trava da 1022. Chega aqui quando duas pessoas geram a mesma
    // mensalidade ao mesmo tempo (a conferência acima não vê a outra): o banco
    // barrou, e a frase precisa dizer isso — não "não foi possível".
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          "A mensalidade deste mês acabou de ser gerada (por outra tela ou por outra pessoa). Nada foi duplicado.",
      };
    }
    console.error("generateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível gerar a cobrança." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: billingType, count: rows.length },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Edita uma cobrança ainda não paga (valor, vencimento e descrição). */
export async function updateBilling(
  companyId: string,
  billingId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: current } = await db
    .from("adhesion_billing")
    .select("status")
    .eq("id", billingId)
    .maybeSingle<{ status: string }>();
  if (!current) return { ok: false, error: "Cobrança não encontrada." };
  if (current.status === "PAID") {
    return { ok: false, error: "Cobrança já paga não pode ser editada." };
  }

  const rawValue = String(formData.get("total") ?? "").trim();
  const cents = Math.round(
    Number.parseFloat(
      rawValue.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
    ) * 100
  );
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: "Informe um valor válido." };
  }
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!dueDate) return { ok: false, error: "Informe o vencimento." };

  const { error } = await db
    .from("adhesion_billing")
    .update({
      total_amount_cents: cents,
      due_date: dueDate,
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .eq("id", billingId);
  if (error) {
    console.error("updateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a cobrança." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { total: cents, due_date: dueDate },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Cancela a cobrança — o motivo é obrigatório (validado também no banco). */
export async function cancelBilling(
  companyId: string,
  billingId: string,
  reason: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (!reason.trim()) {
    return { ok: false, error: "Informe o motivo do cancelamento." };
  }

  const db = await empresarialDb();
  const { error } = await db.rpc("cancel_billing", {
    p_billing_id: billingId,
    p_reason: reason.trim(),
  });
  if (error) {
    console.error("cancelBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível cancelar a cobrança.",
    };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { cancelled: true },
  });
  // A empresa pode sair da suspensão ao acabar o atraso — a lista mostra isso.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/**
 * Baixa manual (simula o webhook do ASAAS) — liquida a cobrança e grava o split.
 * Quando o ASAAS estiver ligado, a Edge Function chama a mesma RPC settle_billing.
 */
export async function markBillingPaid(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("settle_billing", {
    p_billing_id: billingId,
    p_paid_at: new Date().toISOString(),
  });
  if (error) {
    console.error("markBillingPaid failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o pagamento." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { paid: true },
  });
  // Pagar pode tirar a empresa da suspensão por inadimplência.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/**
 * Exclui a cobrança de vez (Admin Master). Diferente de cancelar, que fica no
 * histórico: aqui a linha é apagada — serve para limpar cobranças de TESTE
 * antes de a empresa receber um relatório. O banco registra em audit_logs antes
 * de apagar e reavalia a suspensão da empresa.
 */
export async function deleteBilling(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master pode excluir uma cobrança." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("delete_billing", {
    p_billing_id: billingId,
  });
  if (error) {
    console.error("deleteBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível excluir a cobrança.",
    };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/** Roda a checagem de inadimplência (suspende empresas com atraso > 5 dias). */
export async function runOverdueCheck(companyId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("mark_overdue_and_suspend", {});
  if (error) {
    console.error("runOverdueCheck failed:", error.message);
    return { ok: false, error: "Não foi possível checar a inadimplência." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}
