// Risarte Empresarial — AS VAGAS DO CONTRATO, numa conta só (AP97, item 6 do
// plano de correções da Rita, aprovado pelo dono em 03/11/2026).
//
// Até a 0.95.0 a trava da quantidade contratada vivia dentro de
// `createEmployee`, e o comentário dela dizia valer "para a importação de
// planilha e para qualquer caminho futuro" — mas a importação nunca a chamou.
// A planilha é justamente a lista que a empresa manda; era o caminho que mais
// precisava da trava e o único que não a tinha.
//
// Daqui em diante QUEM PRECISA DE VAGA PERGUNTA AQUI: o cadastro um a um
// pergunta por 1; a importação pergunta pelos CPFs novos da planilha. Duas
// contas para a mesma pergunta é como a tela e a planilha passam a discordar.
//
// ⚠️ SÓ TITULARES OCUPAM VAGA. Dependente não entra nesta conta — ele tem o
// teto dele (`limite_de_dependentes`, 1021), que `addDependent` confere.
//
// Não é "use server": não tem guarda de permissão. Quem chama (a action) é
// quem tem.

import { contagemConfirmada, naoConseguiConferir } from "@/lib/contagem";
import type { empresarialDb } from "./db";
import { recusaDoCadastro, vagasDisponiveis } from "./excedente";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

export type TetoDaProposta = {
  max_adhesions: number | null;
  adhesion_limit_target: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
};

export type RespostaDasVagas =
  | {
      ok: true;
      /** Quantas vagas sobram DEPOIS de incluir os novos. `null` = sem trava. */
      vagas: number | null;
      /** Titulares ativos hoje. `null` quando não precisou contar (sem trava). */
      ativos: number | null;
    }
  | { ok: false; motivo: string };

/**
 * A frase da recusa quando a PLANILHA não cabe (texto do plano aprovado).
 * Diz os dois números e os dois caminhos — "não coube" sozinho faria o RH
 * tentar de novo com a mesma lista.
 */
export function recusaDaPlanilha(novos: number, vagas: number): string {
  return (
    `A planilha tem ${novos} titular(es) novo(s) e a empresa tem só ${vagas} vaga(s); ` +
    `renegocie o limite ou reduza a lista.`
  );
}

/**
 * A CONTA PURA: cabem `quantosNovos` titulares?
 *
 * - `limite` nulo = contrato sem quantidade ("sem trava", regra da 1020).
 * - O MÁXIMO da proposta é um teto separado (pode ser maior que o contratado:
 *   fechou 100, pode chegar a 120 sem renegociar) e só vale para titulares
 *   quando foi combinado para eles.
 * - `ativos` conta SÓ TITULARES. Dependentes não ocupam vaga.
 */
export function conferirVagasParaTitulares(
  limite: number | null,
  teto: TetoDaProposta | null,
  ativos: number,
  quantosNovos: number
): RespostaDasVagas {
  const novos = Math.max(0, Math.floor(quantosNovos));
  const { semTrava, vagas } = vagasDisponiveis(limite, ativos);
  if (!semTrava && vagas < novos) {
    // Um por vez: a frase de sempre (a tela e o manual já a conhecem).
    // Em lote: a frase da planilha, com quantos vieram e quantos cabem.
    const motivo =
      novos <= 1 ? recusaDoCadastro(limite!, ativos) : recusaDaPlanilha(novos, vagas);
    return { ok: false, motivo };
  }

  const tetoVale =
    teto?.max_adhesions != null && teto.adhesion_limit_target !== "DEPENDENTS";
  if (tetoVale && ativos + novos > teto!.max_adhesions!) {
    const maximo = teto!.max_adhesions!;
    const motivo =
      novos <= 1
        ? `Esta empresa já tem ${ativos} titular(es) ativos, e o máximo combinado na proposta é ${maximo}. Renegocie o limite antes de incluir mais.`
        : `A planilha tem ${novos} titular(es) novo(s); a empresa já tem ${ativos} ativo(s) e o máximo combinado na proposta é ${maximo}. Renegocie o limite ou reduza a lista.`;
    return { ok: false, motivo };
  }

  const sobra = semTrava
    ? tetoVale
      ? teto!.max_adhesions! - ativos - novos
      : null
    : tetoVale
      ? Math.min(vagas - novos, teto!.max_adhesions! - ativos - novos)
      : vagas - novos;
  return { ok: true, vagas: sobra, ativos };
}

/**
 * CABEM `quantosNovos` TITULARES NESTA EMPRESA? Lê o banco e responde.
 *
 * Lê, nesta ordem: o limite do contrato (contratado + termos de inclusão
 * aceitos, somado pelo banco em `limite_de_titulares`), o máximo combinado na
 * proposta e, só quando um dos dois existe, quantos titulares estão ativos.
 *
 * ⚠️ AP11 — LEITURA QUE FALHA É RECUSA, NUNCA "SEM TRAVA" NEM "ZERO".
 * `limite_de_titulares` devolve nulo de propósito quando o contrato não tem
 * quantidade; uma consulta que FALHOU também devolve nulo em `data`. Lendo só
 * o `data`, a falha virava "sem trava" e o teto contratado sumia. A contagem
 * dos ativos tem o mesmo buraco (`count ?? 0`). Por isso cada leitura confere
 * o erro antes, e a resposta de falha diz que NADA foi feito.
 */
export async function vagasParaTitulares(
  db: Db,
  companyId: string,
  quantosNovos: number
): Promise<RespostaDasVagas> {
  const { data: limiteRow, error: erroDoLimite } = await db.rpc("limite_de_titulares", {
    p_company_id: companyId,
  });
  if (erroDoLimite) {
    return { ok: false, motivo: naoConseguiConferir("a quantidade contratada da empresa") };
  }
  const limite: number | null =
    typeof limiteRow === "number"
      ? limiteRow
      : ((limiteRow as number[] | null)?.[0] ?? null);

  const { data: teto, error: erroDoTeto } = await db
    .from("companies")
    .select("max_adhesions, adhesion_limit_target")
    .eq("id", companyId)
    .maybeSingle<TetoDaProposta>();
  if (erroDoTeto) {
    return { ok: false, motivo: naoConseguiConferir("o limite combinado na proposta") };
  }

  const precisaContar =
    limite != null ||
    (teto?.max_adhesions != null && teto.adhesion_limit_target !== "DEPENDENTS");
  if (!precisaContar) {
    return { ok: true, vagas: null, ativos: null };
  }

  // SÓ TITULARES (`employees`), e só os ATIVOS: quem saiu devolveu a vaga.
  // Dependentes moram em outra tabela e não entram aqui, de propósito.
  const ativos = contagemConfirmada(
    await db
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
  );
  if (ativos === null) {
    return {
      ok: false,
      motivo: naoConseguiConferir("quantos titulares a empresa já tem ativos"),
    };
  }

  return conferirVagasParaTitulares(limite, teto ?? null, ativos, quantosNovos);
}
