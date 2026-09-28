/**
 * "Há quanto tempo" para os cartões do Indica +Risos.
 *
 * Recebe o AGORA por parâmetro: quem chama é o servidor, uma vez por tela.
 * Perguntar as horas dentro do componente faria servidor e navegador
 * discordarem (ver "CRONÔMETRO NÃO SE DESENHA NO SERVIDOR" na arquitetura).
 * Conta dias CIVIS de Brasília, não blocos de 24h: o que entrou às 23h de
 * ontem é "ontem" às 8h de hoje.
 */
import { isoDateIn } from "@/lib/dates";

function diasEntre(deIso: string, ateIso: string): number {
  const um = Date.UTC(+deIso.slice(0, 4), +deIso.slice(5, 7) - 1, +deIso.slice(8, 10));
  const dois = Date.UTC(+ateIso.slice(0, 4), +ateIso.slice(5, 7) - 1, +ateIso.slice(8, 10));
  return Math.round((dois - um) / 86_400_000);
}

export function haQuantoTempo(instante: string | Date, agora: Date): string {
  const dias = diasEntre(isoDateIn(new Date(instante)), isoDateIn(agora));
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/** Dias civis (Brasília) desde um instante — para "parada há mais de 3 dias". */
export function diasDesde(instante: string | Date, agora: Date): number {
  return Math.max(0, diasEntre(isoDateIn(new Date(instante)), isoDateIn(agora)));
}
