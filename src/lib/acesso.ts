// O ACESSO DE CADA PESSOA — inatividade, login por dia e o registro de cada
// entrada (migração 0287, pedido do dono em 09/10/2026).
//
// QUEM DECIDE É O BANCO (`access_session_check`), a cada requisição. O que
// mora aqui é o que precisa valer igual nos dois lados e por isso é PURO e
// testado: ler a resposta do banco, decidir o que a TELA avisa enquanto o
// tempo corre, e formatar o que a auditoria mostra.
//
// Sem dependência de servidor: este arquivo é importado pelo navegador (o
// monitor da sessão) e pelo servidor (`getSessionContext`).

export const MOTIVOS_DE_SAIDA = ["saiu", "inatividade", "virada_do_dia"] as const;
export type MotivoDeSaida = (typeof MOTIVOS_DE_SAIDA)[number];

export const MOTIVO_ROTULO: Record<MotivoDeSaida, string> = {
  saiu: "Saiu",
  inatividade: "Desconectado por inatividade",
  virada_do_dia: "Desconectado na virada do dia",
};

/** O que a tela de login diz a quem acabou de ser desconectado. */
export const MOTIVO_NO_LOGIN: Record<MotivoDeSaida, string | null> = {
  saiu: null,
  inatividade:
    "Você foi desconectado porque o sistema ficou um tempo sem uso. Entre de novo para continuar.",
  virada_do_dia:
    "O acesso vale para o dia em que foi feito. Entre de novo para registrar o acesso de hoje.",
};

export function lerMotivo(valor: string | null | undefined): MotivoDeSaida {
  return (MOTIVOS_DE_SAIDA as readonly string[]).includes(valor ?? "")
    ? (valor as MotivoDeSaida)
    : "saiu";
}

/** Padrão de todos quando nada foi configurado — espelho do banco (0287). */
export const INATIVIDADE_PADRAO_MIN = 60;
export const INATIVIDADE_MIN = 5;
export const INATIVIDADE_MAX = 720;

export type EstadoDoAcesso = {
  estado: "ok" | "inatividade" | "virada_do_dia" | "encerrada" | "sem_sessao";
  limiteMin: number | null;
  /** A data (aaaa-mm-dd) em que este acesso começou. */
  dia: string | null;
  motivo: string | null;
};

/**
 * Lê a resposta de `access_session_check`.
 *
 * ⚠️ NULO = NÃO CONFERIDO, e quem recebe nulo DEIXA PASSAR. O código viaja
 * sozinho para os dois ambientes e a migração não (CLAUDE.md §0b): na janela
 * em que o banco ainda não tem a 0287 a função não existe, e trancar todo
 * mundo para fora por causa disso seria o pior defeito possível desta
 * entrega. Uma resposta que não se sabe ler recebe o mesmo tratamento.
 */
export function lerEstadoDoAcesso(
  resposta: { data: unknown; error: { message: string } | null } | null | undefined
): EstadoDoAcesso | null {
  if (!resposta || resposta.error) return null;
  const d = resposta.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const estado = d.estado;
  if (
    estado !== "ok" &&
    estado !== "inatividade" &&
    estado !== "virada_do_dia" &&
    estado !== "encerrada" &&
    estado !== "sem_sessao"
  ) {
    return null;
  }
  return {
    estado,
    limiteMin: typeof d.limite_min === "number" ? d.limite_min : null,
    dia: typeof d.dia === "string" ? d.dia : null,
    motivo: typeof d.motivo === "string" ? d.motivo : null,
  };
}

/**
 * Para onde mandar quem teve o acesso encerrado — ou nulo se ele segue.
 * Sempre a rota que encerra de verdade (apaga a sessão e volta ao login).
 */
export function destinoDoAcesso(e: EstadoDoAcesso | null): string | null {
  if (!e) return null;
  if (e.estado === "inatividade" || e.estado === "virada_do_dia") {
    return `/auth/encerrar?motivo=${e.estado}`;
  }
  if (e.estado === "encerrada") {
    return `/auth/encerrar?motivo=${lerMotivo(e.motivo ?? "inatividade")}`;
  }
  return null;
}

/** O IP de quem pediu: o primeiro da lista que o servidor de borda monta. */
export function ipDoPedido(cabecalhos: { get(nome: string): string | null }): string | null {
  const lista = cabecalhos.get("x-forwarded-for");
  const primeiro = lista?.split(",")[0]?.trim();
  return primeiro || cabecalhos.get("x-real-ip")?.trim() || null;
}

// ---------------------------------------------------------------------------
// O QUE A TELA FAZ ENQUANTO O TEMPO CORRE
// ---------------------------------------------------------------------------

/** Com quanto tempo de antecedência a tela avisa que vai desconectar. */
export const AVISO_ANTES_S = 120;
/** De quanto em quanto tempo a tela avisa o banco de que a pessoa está usando. */
export const SINAL_A_CADA_MS = 60_000;

export type SituacaoLocal =
  | { tipo: "ok"; conferirDia: boolean }
  | { tipo: "avisar"; restamS: number; conferirDia: boolean }
  | { tipo: "encerrar"; motivo: "inatividade" };

/**
 * O que a tela faz AGORA.
 *
 * - Gravação de consulta em andamento: nada vence (decisão do dono). O
 *   dentista fica quarenta minutos sem tocar na tela, e desconectar ali
 *   cortaria a gravação.
 * - Sem uso: avisa nos últimos dois minutos, encerra no limite. É uma conta
 *   de TEMPO DECORRIDO — não depende de o relógio do computador estar certo.
 * - A data deste computador é outra (`conferirDia`): **a tela NÃO decide
 *   sozinha**. Quem chama pergunta ao banco e só sai se ELE disser. Um PC com
 *   a data adiantada cairia num ciclo sem fim se a tela encerrasse pelo
 *   próprio relógio: desconecta, a pessoa entra, o acesso novo nasce "de
 *   ontem" para aquele relógio, desconecta de novo. Quem sabe que dia é hoje é
 *   o servidor. E o aviso de inatividade continua valendo nesse computador.
 */
export function situacaoLocal(p: {
  agoraMs: number;
  ultimaInteracaoMs: number;
  limiteMin: number;
  diaDoAcesso: string;
  hoje: string;
  gravando: boolean;
}): SituacaoLocal {
  if (p.gravando) return { tipo: "ok", conferirDia: false };
  const limiteMs = Math.max(1, p.limiteMin) * 60_000;
  const paradoMs = Math.max(0, p.agoraMs - p.ultimaInteracaoMs);
  if (paradoMs >= limiteMs) return { tipo: "encerrar", motivo: "inatividade" };
  const conferirDia = p.hoje !== p.diaDoAcesso;
  const restamMs = limiteMs - paradoMs;
  if (restamMs <= AVISO_ANTES_S * 1000) {
    return { tipo: "avisar", restamS: Math.ceil(restamMs / 1000), conferirDia };
  }
  return { tipo: "ok", conferirDia };
}

/** De quanto em quanto tempo a tela pergunta ao banco se o dia virou. */
export const CONFERIR_DIA_A_CADA_MS = 60_000;

/**
 * Manda o sinal de atividade agora?
 *
 * Só quando a pessoa MEXEU desde o último sinal (ou há gravação) — e no
 * máximo um por minuto. Sinal sem interação transformaria uma aba aberta em
 * "pessoa usando", que é exatamente o que a inatividade existe para negar.
 */
export function deveMandarSinal(p: {
  agoraMs: number;
  ultimaInteracaoMs: number;
  ultimoSinalMs: number;
  gravando: boolean;
}): boolean {
  if (p.agoraMs - p.ultimoSinalMs < SINAL_A_CADA_MS) return false;
  return p.gravando || p.ultimaInteracaoMs > p.ultimoSinalMs;
}

// ---------------------------------------------------------------------------
// O QUE A AUDITORIA MOSTRA
// ---------------------------------------------------------------------------

/** "2h 05min", "37min", "menos de 1min". */
export function duracao(segundos: number | null | undefined): string {
  const s = Math.max(0, Math.floor(segundos ?? 0));
  if (s < 60) return "menos de 1min";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min`;
}

/**
 * Os números de um acesso: quanto durou, quanto foi em uso e quanto parado.
 * Acesso ainda aberto conta até a ÚLTIMA ATIVIDADE — contar até "agora" faria
 * a aba esquecida aparecer como horas de trabalho.
 */
export function temposDoAcesso(a: {
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  activeSeconds: number;
}): { totalS: number; emUsoS: number; paradoS: number } {
  const inicio = new Date(a.startedAt).getTime();
  const fim = new Date(a.endedAt ?? a.lastActivityAt).getTime();
  const totalS = Math.max(0, Math.round((fim - inicio) / 1000));
  const emUsoS = Math.min(totalS, Math.max(0, a.activeSeconds));
  return { totalS, emUsoS, paradoS: totalS - emUsoS };
}

/** "Chrome · Windows" a partir do texto longo que o navegador manda. */
export function navegadorCurto(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "—";
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Outro navegador";
  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return sistema ? `${navegador} · ${sistema}` : navegador;
}

/** As chaves de `access_idle_settings.papel` que não são função. */
export const PAPEL_PADRAO = "*";
export const PAPEL_ADMIN = "admin_master";

/**
 * Confere o que o Admin digitou na tela "Sessão e inatividade".
 *
 * - O PADRÃO é obrigatório: é ele que vale para toda função sem regra própria.
 * - Função em BRANCO = sem regra própria (usa o padrão) → `null`, e a linha
 *   dela sai da tabela. Não é "zero minutos".
 * - Entre 5 e 720 minutos (o mesmo limite que o banco impõe): menos de 5
 *   desconectaria quem parou para atender o telefone; mais de 12 horas não é
 *   limite de inatividade.
 */
export function validarTempos(
  entrada: Record<string, string | null | undefined>,
  papeisConhecidos: readonly string[]
): { ok: true; valores: Record<string, number | null> } | { ok: false; erro: string } {
  const valores: Record<string, number | null> = {};
  for (const papel of [PAPEL_PADRAO, PAPEL_ADMIN, ...papeisConhecidos]) {
    const bruto = (entrada[papel] ?? "").trim();
    if (bruto === "") {
      if (papel === PAPEL_PADRAO) {
        return { ok: false, erro: "Informe o tempo padrão — é ele que vale para as funções sem tempo próprio." };
      }
      valores[papel] = null;
      continue;
    }
    const n = Number(bruto);
    if (!Number.isInteger(n) || n < INATIVIDADE_MIN || n > INATIVIDADE_MAX) {
      return {
        ok: false,
        erro: `O tempo deve ser um número inteiro de minutos, entre ${INATIVIDADE_MIN} e ${INATIVIDADE_MAX}.`,
      };
    }
    valores[papel] = n;
  }
  return { ok: true, valores };
}
