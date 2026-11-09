// Dados públicos da unidade, horário por dia e feriados (0368 — Rita, 0A.4).
//
// Regras PURAS, usadas pelas telas e pelas ações; o banco confere de novo
// (checks da 0368). A normalização do telefone é a MESMA de `rita.phone_e164`
// (3002) — a régua `unidade-publica.test.ts` compara as duas.

/** "+55DDNÚMERO", ou null se não for telefone brasileiro com DDD. */
export function telefoneE164(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  d = d.replace(/^0+/, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (!/^[1-9][1-9]\d{8,9}$/.test(d)) return null;
  return `+55${d}`;
}

export type DadosPublicos = {
  publicName: string | null;
  landmark: string | null;
  mapsUrl: string | null;
  parking: string | null;
  accessibility: string | null;
  whatsappE164: string | null;
  minChildAge: number | null;
};

export type DadosPublicosEntrada = {
  publicName?: string | null;
  landmark?: string | null;
  mapsUrl?: string | null;
  parking?: string | null;
  accessibility?: string | null;
  whatsapp?: string | null;
  minChildAge?: string | number | null;
};

const vazio = (s: string | null | undefined) => {
  const t = String(s ?? "").trim();
  return t ? t : null;
};

/** Confere e normaliza o que a tela mandou. */
export function validarDadosPublicos(
  e: DadosPublicosEntrada
): { ok: true; valores: DadosPublicos } | { ok: false; erro: string } {
  const publicName = vazio(e.publicName);
  if (publicName && (publicName.length < 2 || publicName.length > 120)) {
    return { ok: false, erro: "O nome público deve ter entre 2 e 120 caracteres." };
  }
  const mapsUrl = vazio(e.mapsUrl);
  if (mapsUrl && !/^https:\/\/\S{8,}$/.test(mapsUrl)) {
    return { ok: false, erro: "O link do mapa deve começar com https:// (copie do Google Maps)." };
  }
  for (const [rotulo, v] of [
    ["ponto de referência", e.landmark],
    ["estacionamento", e.parking],
    ["acessibilidade", e.accessibility],
  ] as const) {
    if ((vazio(v)?.length ?? 0) > 300) {
      return { ok: false, erro: `O texto de ${rotulo} passa de 300 caracteres.` };
    }
  }
  const whatsTexto = vazio(e.whatsapp);
  const whatsappE164 = whatsTexto ? telefoneE164(whatsTexto) : null;
  if (whatsTexto && !whatsappE164) {
    return { ok: false, erro: "WhatsApp inválido: informe com DDD, ex.: (43) 99999-1234." };
  }
  const idadeTexto = vazio(e.minChildAge == null ? null : String(e.minChildAge));
  let minChildAge: number | null = null;
  if (idadeTexto) {
    const n = Number(idadeTexto);
    if (!Number.isInteger(n) || n < 0 || n > 17) {
      return { ok: false, erro: "A idade mínima deve ser um número de 0 a 17 (ou vazia)." };
    }
    minChildAge = n;
  }
  return {
    ok: true,
    valores: {
      publicName,
      landmark: vazio(e.landmark),
      mapsUrl,
      parking: vazio(e.parking),
      accessibility: vazio(e.accessibility),
      whatsappE164,
      minChildAge,
    },
  };
}

// ---------------------------------------------------------------- horário por dia

export type HorarioDoDia = {
  weekday: number; // 0 = domingo … 6 = sábado
  closed: boolean;
  open: string; // "HH:MM" ("" quando fechado)
  close: string;
  lunchStart: string; // "" = sem almoço
  lunchEnd: string;
};

const minutos = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** A mesma regra dos checks de `clinic_weekday_hours`. Devolve o erro do 1º dia ruim. */
export function validarHorarioPorDia(
  dias: HorarioDoDia[],
  nomes: readonly string[]
): { ok: true } | { ok: false; erro: string } {
  if (dias.length !== 7 || new Set(dias.map((d) => d.weekday)).size !== 7) {
    return { ok: false, erro: "Informe os 7 dias da semana." };
  }
  for (const d of dias) {
    const nome = nomes[d.weekday] ?? `dia ${d.weekday}`;
    if (d.closed) continue;
    const a = minutos(d.open);
    const f = minutos(d.close);
    if (!(a < f)) return { ok: false, erro: `${nome}: a abertura tem de ser antes do fechamento.` };
    const temAlmoco = Boolean(d.lunchStart || d.lunchEnd);
    if (temAlmoco) {
      const ai = minutos(d.lunchStart);
      const af = minutos(d.lunchEnd);
      if (!(ai < af)) return { ok: false, erro: `${nome}: o almoço precisa de início antes do fim.` };
      if (ai < a || af > f) return { ok: false, erro: `${nome}: o almoço tem de caber no horário do dia.` };
    }
  }
  return { ok: true };
}

/** Um dia aberto, pelo menos (o portão da Rita exige isso). */
export function temDiaAberto(dias: HorarioDoDia[]): boolean {
  return dias.some((d) => !d.closed);
}

// ---------------------------------------------------------------- feriados

export type EscopoDoFeriado = "national" | "state" | "city";

export const ROTULO_DO_ESCOPO: Record<EscopoDoFeriado, string> = {
  national: "Nacional",
  state: "Estadual",
  city: "Municipal",
};
