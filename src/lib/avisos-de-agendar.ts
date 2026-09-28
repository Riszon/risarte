// O AVISO QUE COBRA UM AGENDAMENTO — as partes puras (OC-00080, 27/09/2026).
// A tela está em `src/components/aviso-de-agendar.tsx`; quem tira o aviso é o
// banco, ao criar o agendamento (gatilho da 0283).

/** 15 minutos: o "Fechar" adia, não resolve (dono, 27/09/2026). */
export const ADIAMENTO_MS = 15 * 60 * 1000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * O cliente do aviso, lido do LINK — os avisos gravam '/agenda?cliente=<id>'
 * ou '/prontuarios/<id>' (conferido nas funções que os criam, 0283).
 */
export function clienteDoAviso(link: string | null): string | null {
  return link?.match(UUID)?.[0] ?? null;
}

/**
 * O nome do cliente num aviso de apresentação. Os títulos variam ("Agendar
 * apresentação: Nome", "Agendar apresentação comercial: Nome", "URGENTE:
 * agendar apresentação comercial") e os corpos também ("Nome — Clínica…",
 * "Nome está pronto(a)…", "Fulana pediu … para Nome.").
 */
export function nomeDoAvisoDeApresentacao(title: string, body: string | null): string {
  const doTitulo = title.match(/^agendar apresenta[^:]*:\s*(.+)$/i)?.[1]?.trim();
  if (doTitulo) return doTitulo;
  if (!body) return title;
  const pedido = body.match(/ para (.+?)\.(?: Motivo:|$)/)?.[1]?.trim();
  if (pedido) return pedido;
  return body.split(/ — | está pront/)[0]?.trim() || title;
}

/** O nome do cliente num aviso de fechamento ("Nome fechou o plano…"). */
export function nomeDoAvisoDeFechamento(title: string, body: string | null): string {
  if (!body) return title;
  return body.split(/ (?:fechou|—)/)[0]?.trim() || title;
}

/**
 * UMA LINHA POR CLIENTE (dono, 27/09/2026). O mesmo cliente pode ter dois
 * avisos em aberto (ex.: "Agendar apresentação comercial" e depois "URGENTE:
 * agendar apresentação comercial"); a janela mostra só o MAIS RECENTE. Os
 * outros continuam na central de notificações e saem juntos quando o
 * agendamento for criado (0283). A lista chega do mais novo para o mais velho.
 * Aviso sem cliente no link nunca é juntado a outro.
 */
export function umPorCliente<T extends { id: string; link: string | null }>(itens: readonly T[]): T[] {
  const vistos = new Set<string>();
  const saida: T[] = [];
  for (const i of itens) {
    const chave = clienteDoAviso(i.link) ?? `aviso:${i.id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(i);
  }
  return saida;
}

/**
 * O motivo de um aviso de início que VOLTOU (0284): "Nome — o paciente faltou
 * ao início agendado. Agende de novo." → "o paciente faltou ao início agendado".
 * O aviso original do fechamento não tem motivo.
 */
export function motivoDoAvisoDeInicio(body: string | null): string | null {
  const m = body?.match(/ — (.+?)\. Agende de novo\.?$/);
  return m ? m[1] : null;
}
