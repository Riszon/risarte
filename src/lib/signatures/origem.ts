// AP180 (0.484.0): de onde o pacote "nasce" — o banco só fecha a venda quando a
// assinatura é de um pacote da NEGOCIAÇÃO (`origin_type = plan_negotiation`,
// `signature_apply_webhook`). A aba Documentos da ficha mandava o mesmo
// contrato com a origem "cliente": assinado por todos, a venda não marcava o
// contrato e o Fechamento ainda recusava reenviar ("já assinado").
//
// Regra: pacote da ficha com contrato ou orçamento, e o tratamento ligado é uma
// negociação ACEITA do paciente → o pacote nasce da negociação. O resto fica
// como veio.

import type { PackageOriginType } from "./types";

export type OrigemDoPacote = { type: PackageOriginType; id: string | null };

export function origemDoPacote(input: {
  origem: OrigemDoPacote;
  modelos: { kind: string }[];
  negociacao: { id: string | null; status: string | null };
}): OrigemDoPacote {
  const { origem, modelos, negociacao } = input;
  if (origem.type !== "client") return origem;
  if (!negociacao.id || negociacao.status !== "aceita") return origem;
  if (!modelos.some((m) => m.kind === "contract" || m.kind === "budget")) return origem;
  return { type: "plan_negotiation", id: negociacao.id };
}

/** AP180: as recusas de `commercial_use_signed_package` em português. */
export function mensagemDoUsoDoPacote(erro: string | null | undefined): string {
  const e = erro ?? "";
  if (e.includes("NOT_ALLOWED")) return "Só quem fecha a venda pode usar o pacote no fechamento.";
  if (e.includes("PACKAGE_NOT_SIGNED")) return "Este pacote ainda não foi assinado por todos.";
  if (e.includes("PACKAGE_OTHER_NEGOTIATION")) return "Este pacote é de outra negociação.";
  if (e.includes("PACKAGE_WITHOUT_CONTRACT")) return "Este pacote não tem contrato nem orçamento.";
  if (e.includes("PACKAGE_NOT_FOUND")) return "Pacote não encontrado para este paciente.";
  if (e.includes("NOT_ACCEPTED")) return "A negociação não está aceita.";
  if (e.includes("ALREADY_CLOSED")) return "A venda já está fechada.";
  if (e.includes("Could not find the function")) return "O sistema ainda não recebeu a atualização do banco (migração 0431).";
  return "Não foi possível usar o pacote no fechamento.";
}
