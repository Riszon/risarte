// ASA4, 1B (4015; spec 19.9 acréscimo A, 19.25 e 19.26): a forma dos boletos —
// tipos e os textos da tela (os do Jeferson, de 14/11/2026), com o prazo da rede.

export type FormaDosBoletos = "mensal" | "todos";

export type BoletosDaVenda = {
  forma: FormaDosBoletos;
  tem_boleto: boolean;
  pode_escolher: boolean;
  unidade_ligada: boolean;
  prazo: number;
  boletos_no_carne: number;
  boletos_para_depois: number;
  lista: { id: string; criada_em: string; expira: string; acessos: number; ultimo_acesso: string | null } | null;
  operacoes_interrompidas: number;
};

/** Os textos da escolha: para quem fecha a venda e para o cliente. */
export function textosDaForma(prazo: number): Record<FormaDosBoletos, { titulo: string; paraQuemFecha: string; paraOCliente: string }> {
  return {
    mensal: {
      titulo: "Um boleto por mês",
      paraQuemFecha: `O cliente recebe o primeiro boleto agora. Os próximos chegam para ele cerca de ${prazo} dias antes de cada vencimento, com lembrete. Recomendado: se o plano mudar, é mais simples renegociar.`,
      paraOCliente: `Você recebe o boleto de cada parcela cerca de ${prazo} dias antes do vencimento, por e-mail, SMS ou WhatsApp. Não precisa guardar nada: a cada mês chega o boleto certo.`,
    },
    todos: {
      titulo: "Todos os boletos agora",
      paraQuemFecha:
        "O cliente recebe todos os boletos hoje, numa única mensagem enviada por você. Ele continua recebendo o lembrete de cada parcela perto do vencimento. Atenção: para renegociar ou cancelar o contrato depois, será preciso cancelar os boletos em aberto.",
      paraOCliente: "Você recebe hoje todos os boletos do seu tratamento, de uma vez. Perto de cada vencimento, enviamos um lembrete.",
    },
  };
}

/** A mensagem pronta do WhatsApp com o link da lista. */
export function mensagemDaLista(primeiroNome: string | null, link: string): string {
  return `Olá${primeiroNome ? `, ${primeiroNome}` : ""}! Seguem todos os boletos do seu tratamento: ${link} . Perto de cada vencimento, enviamos um lembrete.`;
}

/** Na tela: o que a confirmação diz antes de cancelar boletos já entregues. */
export function precisaConfirmar(r: { ok: boolean; precisaConfirmar?: number }): boolean {
  return !r.ok && Number(r.precisaConfirmar ?? 0) > 0;
}
