import { apelido } from "@/lib/markdown";

// A AJUDA DE CADA TELA (relato OC-00102, 15/10/2026).
//
// O dono pediu "um ícone de ajuda em cada tela para mostrar o passo a passo".
// Decisão dele: um PAINEL na própria tela (o botão ? da barra de cima), com os
// passos escritos para aquela tela — não só um atalho para o manual.
//
// ⚠️ ISTO É UM SEGUNDO TEXTO, E ELE PODE ENVELHECER SEPARADO DO MANUAL. As
// travas contra isso (`ajuda-das-telas.test.ts`):
//   - toda ajuda aponta a seção do manual que explica o mesmo assunto, e a
//     régua reprova se a seção não existir;
//   - toda rota daqui tem de existir em `src/app` — tela renomeada sem mexer
//     aqui reprova o portão.
// E a mesma disciplina do manual: só entra aqui o que está no código (os
// nomes dos botões são os da tela, conferidos um a um).
//
// Começou por COMPRAS (as telas do relato); depois vieram as mais usadas no
// dia a dia — Agenda, Atendimento, Jornada e a ficha do cliente (15/10/2026).
// Tela sem ajuda escrita mostra isso com honestidade e oferece o manual —
// nunca um passo a passo genérico.

export type AjudaDaTela = {
  /** A rota da tela, como no endereço. `[id]` vale para qualquer valor. */
  rota: string;
  titulo: string;
  /** Para que a tela existe, em uma frase. */
  paraQue: string;
  /** Quem faz o quê nesta tela. */
  quem: string;
  /** O passo a passo, na ordem do trabalho. Nomes de botão em **negrito**. */
  passos: string[];
  /** O que costuma confundir. */
  atencao?: string[];
  /** Onde o manual explica: a seção (##) e, se houver, o trecho (###). */
  manual: { secao: string; trecho?: string };
  /** Endereços que a rota com `[id]` pegaria, mas são OUTRA tela (a pasta
   * vizinha: `/prontuarios/novo` não é a ficha de um cliente "novo"). A régua
   * exige que toda pasta vizinha esteja aqui. */
  naoVale?: string[];
};

const FLUXO_COMPRAS = {
  secao: "8. Fluxos principais de uso",
  trecho: "Fluxo 5 — Compras: pedir, negociar, aprovar e receber",
};

export const AJUDAS: AjudaDaTela[] = [
  {
    rota: "/compras",
    titulo: "Compras — Pedir",
    paraQue:
      "Montar a lista do que falta na unidade e enviar à Franqueadora, que negocia por toda a rede.",
    quem:
      "Monta e envia: o gerente, o coordenador clínico ou o ASB da unidade (e o Admin). As outras funções que abrem esta tela só consultam.",
    passos: [
      "Clique em **Gerar lista de compras**: o sistema sugere o que está abaixo do mínimo no Estoque.",
      "Ajuste as quantidades. Faltou algo? **Acrescentar item** — um item do estoque ou uma linha livre (com a conta de despesa).",
      "Vai comprar por fora da rede? Marque **Compra local** antes de gerar a lista: fica registrado como compra local.",
      "Clique em **Enviar à Franqueadora**. A lista segue para a Mesa de negociação, e o Comprador, o Financeiro da Franqueadora e o Admin recebem o aviso no sino.",
    ],
    atencao: [
      "Cada lista diz quem pediu, a unidade, o dia e a hora, e em que pé está.",
      "Enviada não é para aprovar: a lista está com a Franqueadora. A aprovação só aparece quando ela fecha a negociação — aí a faixa **Aprovar agora** aparece no alto.",
      "Enquanto não é enviada, a lista é um rascunho só da unidade: a Franqueadora passa a ver a partir do envio.",
      "**Cancelar lista** desiste dela.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/rodadas",
    titulo: "Mesa de negociação",
    paraQue:
      "Juntar as listas das unidades, cotar com os fornecedores e escolher de quem comprar cada item.",
    quem:
      "Comprador, Financeiro da Franqueadora e Admin. As unidades não veem as cotações.",
    passos: [
      "**Abrir rodada** com as listas que as unidades enviaram.",
      "Para cada fornecedor, **Incluir na cotação** e digitar o preço de cada item.",
      "Escolha o fornecedor de cada item. Se precisar, altere a quantidade — com o motivo, que a unidade vê ao aprovar.",
      "**Fechar rodada**: cada unidade recebe a sua parte para aprovar, e quem aprova em cada uma recebe o aviso no sino.",
    ],
    atencao: [
      "Preço em branco quer dizer que o fornecedor não cotou; zero é bonificação, e concorre.",
      "Item que ninguém cotou não trava a rodada: volta para a unidade como não negociado.",
      "Cada lista esperando mostra quem a enviou e quando.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/aprovar",
    titulo: "Aprovar compra",
    paraQue:
      "Ver o que a rede negociou para a unidade e decidir: o que for aprovado vira pedido.",
    quem:
      "Quem aprova é quem paga: o gerente da unidade (e o Admin). Na compra da própria Franqueadora, o Financeiro da Franqueadora. Quem não decide vê, na coluna Decisão, quem decide.",
    passos: [
      "Confira cada item: o preço previsto, o negociado e a economia.",
      "**Aprovar** ou **Recusar** item a item. Recusar pede o motivo — a Franqueadora vê.",
      "Clique em **Gerar pedidos**: nasce um pedido por fornecedor, faturado e entregue na unidade.",
    ],
    atencao: [
      "Item sem decisão não vira pedido — o sistema não aprova sozinho.",
      "Item que já virou pedido não volta atrás por aqui: desfazer exige cancelar o pedido.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/receber",
    titulo: "Receber a entrega",
    paraQue:
      "Registrar a entrega: o material entra no estoque e a conta a pagar nasce sozinha.",
    quem:
      "Gerente da unidade, Financeiro da Franqueadora e Admin. O coordenador e o ASB montam a lista, mas não recebem: o recebimento cria a conta a pagar.",
    passos: [
      "Quando a entrega chegar, abra o pedido e confira pela nota fiscal.",
      "Informe, item a item, a quantidade que chegou e o preço da nota (e o lote, nos itens de estoque).",
      "Preencha a nota fiscal, a emissão, as parcelas e o 1º vencimento.",
      "Clique em **Registrar entrega**.",
    ],
    atencao: [
      "Vale o preço da NOTA, não o do pedido: a diferença fica registrada para a próxima negociação.",
      "Chegou só parte? Registre o que veio — o pedido continua aberto até chegar o resto.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/painel",
    titulo: "Painel de compras",
    paraQue:
      "Ver quanto a negociação conjunta economizou e quanto foi comprado por fora da rede.",
    quem:
      "Gerente e franqueado veem a própria unidade; a Franqueadora vê a rede e pode escolher uma unidade.",
    passos: [
      "Escolha o período (**De** e **Até**) e, na Franqueadora, a unidade.",
      "Economia: o previsto comparado com o negociado, só nos itens que foram negociados.",
      "Comprado por fora: as compras locais e o que foi lançado direto no Estoque, sem pedido.",
    ],
    atencao: ["A economia é medida contra a PREVISÃO de preço da lista, não contra o mercado."],
    manual: FLUXO_COMPRAS,
  },
  // As telas mais usadas no dia a dia (escolha do dono, 15/10/2026).
  {
    rota: "/agenda",
    titulo: "Agenda",
    paraQue:
      "Marcar, remarcar e acompanhar os horários da unidade — por dia, semana ou mês.",
    quem:
      "Agendam a recepção e a SDR (que pode agendar em outra unidade). As outras funções consultam conforme a permissão de cada uma; o dentista vê a agenda dele.",
    passos: [
      "Clique em **Novo agendamento**.",
      "Procure o cliente digitando o nome, o código do prontuário ou o CPF.",
      "Escolha o tipo, o profissional, a sala, a duração, a data e o horário — ou use a lista **Próximos horários disponíveis**: clicar num horário confirma o agendamento.",
      "Clique em **Agendar**.",
      "Para mudar a situação (confirmado, faltou, cancelado), clique no agendamento e use **Alterar situação**.",
    ],
    atencao: [
      "O sistema recusa horário fora do funcionamento da unidade, dia fechado ou sala lotada — exceto urgência e emergência.",
      "Num dia fechado pelo **Planejamento anual** (recesso, férias coletivas, evento, treinamento, manutenção), um horário avulso abre só a janela dele: o horário normal do dia não volta. Período travado pela rede não abre nem com horário avulso.",
      "**Fechar agenda** fecha um período da unidade, de uma sala ou de um profissional. **Mais ações** leva a **Configurar agenda**, **Planejamento anual** e **Retornos e controles**, para quem pode mexer neles.",
    ],
    manual: { secao: "6. Scripts de treinamento por função", trecho: "6.1. Recepcionista" },
  },
  {
    rota: "/atendimento",
    titulo: "Atendimento — a sala de espera",
    paraQue:
      "Acompanhar os atendimentos de hoje: quem vai chegar, quem está esperando, quem está sendo atendido e quem já terminou.",
    quem:
      "A recepção confirma e registra a chegada. Quem chama e conclui é o profissional do atendimento.",
    passos: [
      "O paciente avisou que vem? No cartão **A chegar**, clique em **Confirmar**.",
      "Ele chegou: **Registrar chegada**, confira com ele o profissional, o horário e a sala, e clique em **Confirmar chegada**.",
      "O profissional clica em **Chamar** quando for atendê-lo.",
      "Terminou: **Concluir**, marque as sessões que foram feitas e clique em **Concluir atendimento**.",
    ],
    atencao: [
      "Avaliação e reavaliação terminam no cockpit: o cartão mostra **Abrir avaliação**, e não Concluir.",
      "O paciente não veio? No menu do cartão: **Não compareceu (faltou)** ou **Cancelou em cima da hora**.",
      "Confirmar (ele disse que vem) não é Confirmar chegada (ele está na sua frente).",
    ],
    manual: { secao: "6. Scripts de treinamento por função", trecho: "6.1. Recepcionista" },
  },
  {
    rota: "/jornada",
    titulo: "Jornada do Cliente",
    paraQue:
      "Ver em que fase da jornada está cada cliente, há quanto tempo está nela e se tem horário marcado.",
    quem:
      "Consulta de quem acompanha a jornada. A fase anda sozinha, pelo trabalho feito; só o Admin Master move à mão.",
    passos: [
      "Cada coluna é uma fase; cada cartão, um cliente. Cartão com borda vermelha passou do prazo da fase (**SLA estourado**).",
      "**Sem agendamento** quer dizer que o cliente não tem horário marcado daqui para a frente: clique para abrir a agenda e agendar.",
      "Filtre por pilar de tratamento e por ativos ou inativos (na Franqueadora, também por unidade).",
      "Coordenador: na avaliação e na reavaliação, o cartão tem **Cockpit de avaliação**.",
    ],
    atencao: [
      "Não existe botão de mover de fase para a equipe: a fase muda pelo check-in, pelo envio ao Planejamento, pela venda fechada. Fase que parece travada é um passo do fluxo que ainda falta.",
      "Admin Master: **Mover para...** força a passagem — e ela fica marcada na auditoria como forçada.",
      "No alto: **Cadastrar cliente** e **Ir para a agenda**.",
    ],
    manual: {
      secao: "8. Fluxos principais de uso",
      trecho: "Fluxo 2b — Quem move o cliente de fase (e quando)",
    },
  },
  {
    rota: "/prontuarios/[id]",
    titulo: "Ficha do cliente (prontuário)",
    paraQue:
      "Tudo do cliente num lugar só, em abas na ordem do trabalho: cadastro, jornada, clínico, plano, sessões, documentos, financeiro e histórico.",
    quem:
      "Cada função vê as abas do seu trabalho: a recepção não vê os dados de saúde, e o dentista vê só os pacientes dele.",
    passos: [
      "Os dados pessoais ficam na aba **Cadastro**. A ficha abre só para leitura; para mudar, **Editar**.",
      "Para marcar um horário, **Novo agendamento**, no alto da ficha.",
      "A aba **Jornada** mostra a fase, o tempo nela e o pilar do tratamento.",
      "A aba **Plano** traz as opções de tratamento — é ali que o Coordenador aprova ou reprova cada opção.",
      "Em **Sessões & Procedimentos**, o que foi planejado e o que já foi feito. Em **Financeiro**, as cobranças: o número vermelho na aba é o que está em atraso.",
      "O **Histórico** mostra os agendamentos, as unidades e as alterações do cadastro.",
    ],
    atencao: [
      "Abrir a ficha fica registrado (exigência da LGPD): olhar é registrado, mas não chama o paciente.",
      "Falta uma aba? Ela depende da sua função — não é defeito.",
    ],
    manual: { secao: "6. Scripts de treinamento por função", trecho: "6.1. Recepcionista" },
    naoVale: ["/prontuarios/novo"],
  },
  {
    // ZS1 (0340): a configuração da assinatura digital. Só o Admin Master (ou
    // quem ganhou "Configurar as assinaturas" em Permissões).
    rota: "/assinaturas/configuracoes",
    titulo: "Assinaturas digitais — Configurações",
    paraQue:
      "Definir, para toda a rede, os prazos do link, o corte da autenticação reforçada, o plano da ZapSign, a mensagem que vai com o link e quem recebe o relatório mensal.",
    quem: "O Admin Master. Outra função só entra se ganhar \"Configurar as assinaturas\" em Administração → Permissões.",
    passos: [
      "Em **Prazos e autenticação**, confira o corte (acima dele o cliente assina com selfie e código), a validade do link e os dias de lembrete.",
      "Em **Plano ZapSign**, preencha o **Nome do plano**, **Documentos por mês no plano** e **Avisar ao atingir (%)**: o sistema avisa os Admins quando o consumo do mês chegar lá.",
      "Em **Mensagem padrão do link**, ajuste o texto do WhatsApp. Só os campos listados são trocados pelo valor real.",
      "Em **Relatório mensal**, escreva uma pessoa por linha (Nome <email> ou só o e-mail).",
      "Clique em **Salvar configurações**. Tudo grava de uma vez e fica na Auditoria.",
    ],
    atencao: [
      "O token da ZapSign não se digita aqui: é configuração da Vercel. A faixa no alto só diz se ele existe e se o ambiente é sandbox ou produção.",
      "Treino e produção têm configurações separadas: ajuste nos dois.",
      "Nesta etapa nenhum documento é enviado ainda — o envio chega nas etapas seguintes.",
    ],
    manual: { secao: "13d. Para o Admin Master: assinaturas digitais (ZapSign)" },
  },
];

function casa(rota: string, caminho: string): boolean {
  const padrao = rota
    .split("/")
    .map((parte) => (/^\[.+\]$/.test(parte) ? "[^/]+" : parte.replace(/[.*+?^${}()|\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${padrao}$`).test(caminho);
}

/** A ajuda da tela deste endereço, ou `null` quando ainda não foi escrita. */
export function ajudaDaTela(caminho: string): AjudaDaTela | null {
  const limpo = caminho.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return AJUDAS.find((a) => casa(a.rota, limpo) && !a.naoVale?.includes(limpo)) ?? null;
}

/** O endereço do manual aberto na seção (e rolado até o trecho) desta ajuda. */
export function linkDoManual(manual: AjudaDaTela["manual"]): string {
  const base = `/manual?secao=${apelido(manual.secao)}`;
  return manual.trecho ? `${base}#${apelido(manual.trecho)}` : base;
}
