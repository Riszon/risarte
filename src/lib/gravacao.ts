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

/** mm:ss — o tempo correndo na faixa, para o paciente ver junto. */
export function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
