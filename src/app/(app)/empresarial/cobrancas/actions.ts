"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { previewBilling } from "../[companyId]/billing-actions";

export type ResultadoEmLote = {
  ok: boolean;
  error?: string;
  /** Quantas cobranças foram efetivamente afetadas. */
  feitas?: number;
  /** O que NÃO foi feito, e por quê — nunca some em silêncio. */
  pulados?: { empresa: string; motivo: string }[];
};

/**
 * AS AÇÕES EM LOTE DA TELA DE COBRANÇAS.
 *
 * ⚠️ OPERAÇÃO EM MASSA NESTE PROJETO JÁ CUSTOU DADO REAL (CLAUDE.md §0), e a
 * lição virou regra: o que a operação NÃO fez tem de voltar dito, item por
 * item. Um lote que responde só "pronto" esconde exatamente o caso que
 * precisava de gente — e quem confere é quem paga o preço de descobrir depois.
 */

/**
 * BAIXA MANUAL EM VÁRIAS COBRANÇAS.
 *
 * ⚠️ UMA POR VEZ, PELA MESMA PORTA DA TELA DA EMPRESA (`settle_billing`). Seria
 * mais rápido escrever um `update ... in (...)`, e seria errado: a função do
 * banco não só marca como paga — ela calcula o split Risarte/RisLife e reavalia
 * a suspensão por inadimplência da empresa. Um caminho paralelo para "dar
 * baixa" nasceria sem essas duas coisas, e a divergência apareceria meses
 * depois, no split.
 */
export async function baixarCobrancasEmLote(
  ids: string[]
): Promise<ResultadoEmLote> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (ids.length === 0) return { ok: false, error: "Nenhuma cobrança escolhida." };

  const db = await empresarialDb();

  // Só o que ainda não foi pago. Selecionar uma paga e mandar baixar de novo
  // reescreveria a data do pagamento — e a data do pagamento é o que decide a
  // competência do split.
  type Alvo = {
    id: string;
    status: string;
    company_id: string;
    companies: { legal_name: string; trade_name: string | null } | null;
  };

  const { data: alvos } = await db
    .from("adhesion_billing")
    .select("id, status, company_id, companies ( legal_name, trade_name )")
    .in("id", ids)
    .returns<Alvo[]>();

  const pulados: { empresa: string; motivo: string }[] = [];
  const nomeDe = (r: Alvo) =>
    r.companies?.trade_name || r.companies?.legal_name || "empresa";

  let feitas = 0;
  const agora = new Date().toISOString();
  for (const alvo of alvos ?? []) {
    if (alvo.status === "PAID") {
      pulados.push({ empresa: nomeDe(alvo), motivo: "já estava paga" });
      continue;
    }
    if (alvo.status === "CANCELLED") {
      pulados.push({ empresa: nomeDe(alvo), motivo: "está cancelada" });
      continue;
    }
    const { error } = await db.rpc("settle_billing", {
      p_billing_id: alvo.id,
      p_paid_at: agora,
    });
    if (error) {
      console.error("baixarCobrancasEmLote falhou:", error.message);
      pulados.push({ empresa: nomeDe(alvo), motivo: "o banco recusou a baixa" });
      continue;
    }
    feitas++;
  }

  if (feitas > 0) {
    await logAudit({
      action: "update",
      entityType: "empresarial_billing",
      entityId: "lote",
      details: { paid: true, count: feitas },
    });
    revalidatePath("/empresarial/cobrancas");
    revalidatePath("/empresarial");
  }

  return { ok: feitas > 0 || pulados.length > 0, feitas, pulados };
}

/**
 * GERA A MENSALIDADE DE VÁRIAS EMPRESAS DE UMA VEZ.
 *
 * ⚠️ E NÃO GERA DUAS VEZES O MESMO MÊS. Descoberto ao construir esta tela
 * (10/09/2026): `generateBilling` só insere, e **não há trava no banco** —
 * gerar a mensalidade de setembro duas vezes cria duas cobranças de setembro.
 * Na tela da empresa isso ainda seria notado, porque a lista está logo ali; num
 * botão que roda para a rede inteira, a duplicata nasceria invisível e chegaria
 * ao cliente como boleto a mais.
 *
 * A guarda aqui é do aplicativo: antes de gerar, pergunta se a empresa já tem
 * cobrança do tipo naquele mês de referência. **Isto não substitui uma trava no
 * banco** — duas pessoas clicando ao mesmo tempo ainda passariam pelas duas
 * verificações. A trava de verdade é um índice único, que precisa de migração e
 * de conferir se já existem duplicatas em produção; está anotado para o dono
 * decidir, e a tela não finge que o problema não existe.
 */
export async function gerarMensalidadesEmLote(
  companyIds: string[]
): Promise<ResultadoEmLote> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (companyIds.length === 0) {
    return { ok: false, error: "Nenhuma empresa escolhida." };
  }

  const db = await empresarialDb();
  const pulados: { empresa: string; motivo: string }[] = [];
  let feitas = 0;

  // Os nomes vêm ANTES do laço. O que a operação pulou precisa voltar com o
  // nome da empresa, e a prévia não devolve nome — sem isto, a lista de pulados
  // diria "empresa" cinco vezes, que é o mesmo que não dizer nada.
  const { data: empresas } = await db
    .from("companies")
    .select("id, legal_name, trade_name")
    .in("id", companyIds)
    .returns<{ id: string; legal_name: string; trade_name: string | null }[]>();
  const nomePor = new Map(
    (empresas ?? []).map((c) => [c.id, c.trade_name || c.legal_name])
  );
  const nomeDaEmpresa = (id: string) => nomePor.get(id) ?? "empresa";

  for (const companyId of companyIds) {
    // A prévia é a MESMA da tela da empresa: valor, vencimento, pagador e a
    // quebra por CNPJ quando a empresa cobra por documento. Recalcular aqui
    // faria a rede receber um valor e a empresa, outro.
    const preview = await previewBilling(companyId, "MONTHLY");
    if (!preview.ok || !preview.items || preview.items.length === 0) {
      pulados.push({
        empresa: nomeDaEmpresa(companyId),
        motivo: preview.error ?? "sem valor a cobrar",
      });
      continue;
    }

    const { count } = await db
      .from("adhesion_billing")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("billing_type", "MONTHLY")
      .eq("reference_month", preview.referenceMonth)
      .neq("status", "CANCELLED");

    if ((count ?? 0) > 0) {
      pulados.push({
        empresa: nomeDaEmpresa(companyId),
        motivo: "já tem cobrança deste mês",
      });
      continue;
    }

    const rows = preview.items.map((i) => ({
      company_id: companyId,
      company_document_id: i.documentId,
      billing_type: "MONTHLY",
      reference_month: preview.referenceMonth,
      total_amount_cents: i.totalCents,
      status: "PENDING",
      due_date: preview.dueDate,
      description: preview.description,
    }));

    const { error } = await db.from("adhesion_billing").insert(rows);
    if (error) {
      console.error("gerarMensalidadesEmLote falhou:", error.message);
      pulados.push({
        empresa: nomeDaEmpresa(companyId),
        motivo: "o banco recusou a criação",
      });
      continue;
    }
    feitas += rows.length;
  }

  if (feitas > 0) {
    await logAudit({
      action: "create",
      entityType: "empresarial_billing",
      entityId: "lote",
      details: { type: "MONTHLY", count: feitas },
    });
    revalidatePath("/empresarial/cobrancas");
    revalidatePath("/empresarial");
  }

  return { ok: true, feitas, pulados };
}
