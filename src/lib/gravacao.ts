/**
 * A GRAVAÇÃO DA CONSULTA — vocabulário comum entre quem PEDE e quem GRAVA.
 *
 * Relato OC-00060 (Coordenador Clínico, 21/09/2026): *"quando a consulta
 * iniciar, a gravação deve iniciar junto"*. A razão dada pelo dono é o que
 * manda no desenho: **a transcrição e o resumo dependem do áudio existir**, e
 * como está "corre o risco de o avaliador esquecer de ligar o gravador".
 * Gravador que depende de memória humana falha justamente no dia cheio.
 *
 * Por que eventos, e não uma prop: quem manda começar (o painel de Atendimento,
 * a tela da Avaliação) NÃO é quem grava. Quem grava mora na barra de cima, que
 * é o único lugar do sistema que continua montado quando a pessoa troca de
 * tela — e a consulta inteira acontece trocando de tela (ficha, anamnese,
 * fotos). Passar prop não atravessaria a navegação; o evento atravessa.
 */

/** Pedido de começar a gravar — ouvido pela barra de cima. */
export const GRAVACAO_INICIAR = "risarte:gravacao-iniciar";
/** Pedido de parar e SALVAR — o fim do atendimento dispara isto. */
export const GRAVACAO_PARAR = "risarte:gravacao-parar";

export type PedidoDeGravacao = {
  clientId: string;
  clinicId: string;
  clientName: string;
  /** O atendimento que está sendo gravado: é o fim dele que fecha a gravação. */
  appointmentId: string | null;
};

/**
 * ⚠️ TETO DE DURAÇÃO — 2 horas.
 *
 * A gravação para sozinha ao fim do atendimento, mas "fim do atendimento" é um
 * clique que alguém pode esquecer (é o mesmo esquecimento que originou o
 * relato). Sem teto, um navegador aberto no fim do expediente gravaria a noite
 * inteira: arquivo gigante, microfone ligado e conta de armazenamento — sem
 * nada de clínico dentro. O teto SALVA o que já gravou, não descarta.
 */
export const LIMITE_DE_GRAVACAO_S = 2 * 60 * 60;

/** De quanto em quanto tempo se confere se o atendimento ainda está aberto. */
export const CONFERIR_ATENDIMENTO_S = 60;

/** O tipo de agendamento em que a gravação começa sozinha (decisão do dono). */
export const TIPOS_QUE_GRAVAM = ["evaluation", "reevaluation"] as const;

/**
 * ⚠️ A ÚNICA DISPENSA DO CONSENTIMENTO — e ela é estreita de propósito.
 *
 * **Decisão do dono, 21/09/2026, com o jurídico dele:** o ÁUDIO da avaliação e
 * da reavaliação não depende do consentimento registrado, porque a gravação
 * precisa começar junto com o atendimento (relato OC-00060) — esperar o
 * registro é como se perde a consulta inteira.
 *
 * Tudo o mais continua como sempre foi: foto, exame, vídeo e anamnese exigem o
 * consentimento, e o áudio fora dessas duas fases também. Esta função é uma
 * regra PURA justamente para poder ser provada por teste: uma dispensa de
 * LGPD que mora espalhada em `if`s é uma dispensa que cresce sem ninguém ver.
 */
export function dispensaConsentimento(
  kind: string,
  faseDaJornada: string | null | undefined
): boolean {
  if (kind !== "audio") return false;
  return faseDaJornada === "clinical_conversion" || faseDaJornada === "reevaluation";
}

export function pedirGravacao(pedido: PedidoDeGravacao) {
  window.dispatchEvent(new CustomEvent(GRAVACAO_INICIAR, { detail: pedido }));
}

export function pedirParaParar(appointmentId?: string | null) {
  window.dispatchEvent(
    new CustomEvent(GRAVACAO_PARAR, { detail: { appointmentId: appointmentId ?? null } })
  );
}

/** O formato que o navegador desta pessoa consegue gravar. */
export function formatoDisponivel(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

export function extensaoDe(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "dat";
}

/**
 * QUEM ESTÁ SENDO GRAVADO AGORA — para as telas não oferecerem um segundo
 * gravador por cima do primeiro.
 *
 * Dois gravadores ao mesmo tempo dariam dois arquivos da mesma consulta, cada
 * um com metade da conversa; e o botão "Gravar consulta" da ficha, se não
 * soubesse da barra, apareceria convidando a isso. O estado mora aqui (é do
 * navegador, uma aba por pessoa) e quem desenha assina.
 */
let clienteEmGravacao: string | null = null;
const ouvintes = new Set<() => void>();

export function marcarGravacao(clientId: string | null) {
  clienteEmGravacao = clientId;
  ouvintes.forEach((f) => f());
}

export function assinarGravacao(aoMudar: () => void) {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

export function clienteGravando(): string | null {
  return clienteEmGravacao;
}

/** No servidor não existe gravação — e responder isso evita o desencontro
 *  entre o que o servidor desenha e o que o navegador desenha (lição do `useNow`). */
export function nadaNoServidor(): null {
  return null;
}

/**
 * ONDE A FAIXA FICA — e por que ela se move (relato OC-00069, 22/09/2026).
 *
 * A primeira versão nasceu larga e centralizada no rodapé, e cobriu justamente
 * a faixa da tela onde moram os botões de ação ("Enviar ao Centro de
 * Planejamento"). O Coordenador relatou no dia seguinte: *"fica em cima da tela
 * da avaliação e não tem como mover"*.
 *
 * ⚠️ O QUE NÃO MUDA: enquanto grava, a faixa continua VISÍVEL. A decisão de
 * 21/09 (dispensar o consentimento formal do áudio, mas nunca gravar às
 * escondidas) depende disso. Por isso ela **encolhe e se move**, e não fecha:
 * mesmo encolhida mostra o ponto vermelho e o tempo correndo.
 */
export const LUGAR_DA_FAIXA = "risarte.gravacao.lugar";
export const FAIXA_ENCOLHIDA = "risarte.gravacao.encolhida";

export type Lugar = { x: number; y: number };
export type JeitoDaFaixa = { lugar: Lugar | null; encolhida: boolean };

/** O padrão: canto de baixo à direita, inteira. Referência FIXA de propósito —
 *  `useSyncExternalStore` compara por identidade e redesenharia sem parar. */
const PADRAO: JeitoDaFaixa = { lugar: null, encolhida: false };

let jeito: JeitoDaFaixa | null = null;
const ouvintesDoJeito = new Set<() => void>();

function lerDoNavegador(): JeitoDaFaixa {
  // ⚠️ SEMPRE em try/catch: em janela anônima, com cookies bloqueados ou com o
  // armazenamento cheio, o `localStorage` LEVANTA erro — e uma preferência de
  // canto não pode derrubar a gravação da consulta.
  try {
    const salvo = localStorage.getItem(LUGAR_DA_FAIXA);
    const p = salvo ? (JSON.parse(salvo) as Lugar) : null;
    const valido = p && typeof p.x === "number" && typeof p.y === "number";
    return {
      lugar: valido ? p : null,
      encolhida: localStorage.getItem(FAIXA_ENCOLHIDA) === "1",
    };
  } catch {
    return PADRAO;
  }
}

/** No navegador: o que ficou guardado. */
export function jeitoDaFaixa(): JeitoDaFaixa {
  if (!jeito) jeito = lerDoNavegador();
  return jeito;
}

/** No servidor: o padrão, sempre o MESMO objeto — senão o React redesenha em
 *  laço, e servidor e navegador discordariam no primeiro desenho. */
export function jeitoNoServidor(): JeitoDaFaixa {
  return PADRAO;
}

export function assinarJeitoDaFaixa(aoMudar: () => void) {
  ouvintesDoJeito.add(aoMudar);
  return () => {
    ouvintesDoJeito.delete(aoMudar);
  };
}

function mudarJeito(novo: JeitoDaFaixa) {
  jeito = novo;
  ouvintesDoJeito.forEach((f) => f());
}

export function guardarLugarDaFaixa(lugar: Lugar | null) {
  mudarJeito({ ...jeitoDaFaixa(), lugar });
  try {
    if (lugar) localStorage.setItem(LUGAR_DA_FAIXA, JSON.stringify(lugar));
    else localStorage.removeItem(LUGAR_DA_FAIXA);
  } catch {
    // a faixa continua onde está nesta sessão
  }
}

export function guardarFaixaEncolhida(encolhida: boolean) {
  mudarJeito({ ...jeitoDaFaixa(), encolhida });
  try {
    localStorage.setItem(FAIXA_ENCOLHIDA, encolhida ? "1" : "0");
  } catch {
    // idem
  }
}

/**
 * Mantém a faixa dentro da janela, com uma margem.
 *
 * Existe porque arrastar até a borda e soltar deixaria a faixa meio fora da
 * tela — e o que ficaria de fora é justamente o botão "Parar e salvar". Vale
 * também quando a janela MUDA de tamanho depois: a posição guardada ontem num
 * monitor grande não pode deixar a faixa invisível no notebook de hoje.
 */
export function limitarNaJanela(
  lugar: Lugar,
  faixa: { largura: number; altura: number },
  janela: { largura: number; altura: number },
  margem = 8
): Lugar {
  const maxX = Math.max(margem, janela.largura - faixa.largura - margem);
  const maxY = Math.max(margem, janela.altura - faixa.altura - margem);
  return {
    x: Math.min(Math.max(lugar.x, margem), maxX),
    y: Math.min(Math.max(lugar.y, margem), maxY),
  };
}

/** mm:ss — o tempo correndo na faixa, para o paciente ver junto. */
export function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
