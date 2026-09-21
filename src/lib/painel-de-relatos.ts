// O PAINEL DE RELATOS (0258) — as regras da tela, puras e testadas.
//
// A CONTA passou a morar AQUI (20/09/2026, ver o bloco no fim do arquivo);
// antes era do banco (`system_reports_dashboard`, 0258). Aqui fica também o que a tela
// decide sozinha: qual período abrir, como ler um período vindo do endereço,
// como escrever taxa e duração sem mentir quando não há base, e quem enxerga o
// link do painel (espelho da regra do banco — quem decide de verdade é ele).

import { addDaysIso, isoDateIn, monthRangeOf, weekdayOf } from "@/lib/dates";
import type { ModuloDoSistema, SituacaoDeRelato, TipoDeRelato } from "@/lib/system-reports";

export type PainelDeRelatos = {
  escopo: {
    rede: boolean;
    grao: "week" | "month";
    unidades: { id: string; nome: string }[];
  };
  totais: {
    relatos: number;
    erros: number;
    erros_resolvidos: number;
    erros_nao_defeito: number;
    duvidas: number;
    duvidas_respondidas: number;
    sugestoes: number;
    sugestoes_implantadas: number;
    sugestoes_recusadas: number;
    em_aberto: number;
    sem_resposta: number;
    reabertos: number;
  };
  respostas_enviadas: number;
  tempos: {
    resposta_media_h: number | null;
    resposta_mediana_h: number | null;
    respondidos: number;
    conclusao_media_h: number | null;
    conclusao_mediana_h: number | null;
    concluidos: number;
    concluidos_sem_data: number;
  };
  por_modulo: {
    modulo: ModuloDoSistema | "sem";
    relatos: number;
    sugestoes: number;
    implantadas: number;
    erros: number;
    erros_resolvidos: number;
    duvidas: number;
  }[];
  por_unidade: {
    clinic_id: string;
    nome: string;
    relatos: number;
    aproveitados: number;
    sugestoes: number;
    implantadas: number;
    pessoas: number;
  }[];
  /** `null` fora da rede: unidade não vê ranking de pessoas (decisão do dono). */
  por_pessoa:
    | {
        reporter_id: string;
        nome: string;
        papel: string | null;
        unidades: string;
        relatos: number;
        aproveitados: number;
        sugestoes: number;
        implantadas: number;
      }[]
    | null;
  parados: {
    code: string;
    kind: TipoDeRelato;
    status: SituacaoDeRelato;
    modulo: ModuloDoSistema | "sem";
    unidade: string;
    criado_em: string;
    sem_resposta: boolean;
    reopened_count: number;
  }[];
  serie: { inicio: string; relatados: number; concluidos: number }[];
};

// -----------------------------------------------------------------------------
// Período
// -----------------------------------------------------------------------------

export const PERIODOS = [
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "mes", label: "Este mês" },
  { value: "ano", label: "Este ano" },
] as const;

export type PeriodoPronto = (typeof PERIODOS)[number]["value"];

/**
 * O padrão é 90 dias: relato é coisa rara (uma operação de ~15 pessoas), e
 * num mês só os indicadores quase sempre dariam "sem base".
 */
export const PERIODO_PADRAO: PeriodoPronto = "90d";

export type Periodo = { de: string; ate: string; pronto: PeriodoPronto | null };

function ehData(v: string | undefined | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  // "2026-02-31" vira março no Date — só vale se voltar igual.
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function periodoPronto(p: PeriodoPronto, hoje: string): Periodo {
  switch (p) {
    case "30d":
      return { de: addDaysIso(hoje, -29), ate: hoje, pronto: p };
    case "90d":
      return { de: addDaysIso(hoje, -89), ate: hoje, pronto: p };
    case "mes":
      return { de: monthRangeOf(hoje).from, ate: hoje, pronto: p };
    case "ano":
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje, pronto: p };
  }
}

/**
 * Lê o período do endereço. Data personalizada ganha do pronto; data que não
 * dá para ler é ignorada (cai no padrão) em vez de derrubar a tela — a lição do
 * filtro de Recebíveis (OC-00009). Período invertido é desvirado.
 */
export function lerPeriodo(
  params: { periodo?: string | null; de?: string | null; ate?: string | null },
  hoje: string
): Periodo {
  const de = ehData(params.de) ? params.de : null;
  const ate = ehData(params.ate) ? params.ate : null;
  if (de || ate) {
    const inicio = de ?? addDaysIso(ate!, -89);
    const fim = ate ?? hoje;
    return inicio <= fim
      ? { de: inicio, ate: fim, pronto: null }
      : { de: fim, ate: inicio, pronto: null };
  }
  const pronto = PERIODOS.find((p) => p.value === params.periodo)?.value ?? PERIODO_PADRAO;
  return periodoPronto(pronto, hoje);
}

// -----------------------------------------------------------------------------
// Números
// -----------------------------------------------------------------------------

/** Percentual inteiro, ou `null` sem base — "0%" de zero relatos não é 0%. */
export function taxa(parte: number, total: number): number | null {
  if (!total) return null;
  return Math.round((parte / total) * 100);
}

/**
 * Duração em horas escrita para gente: "40 min", "5,5 h", "3,2 dias".
 * `null` = ninguém chegou lá ainda — a tela escreve "sem dado", nunca "0 h".
 */
export function rotuloDeHoras(horas: number | null | undefined): string | null {
  if (horas === null || horas === undefined || Number.isNaN(Number(horas))) return null;
  const h = Math.max(0, Number(horas));
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${formatar(h)} h`;
  return `${formatar(h / 24)} dias`;
}

function formatar(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** A maior contagem de uma lista — base das barras. Nunca zero (divisão). */
export function maiorDe(valores: number[]): number {
  return Math.max(1, ...valores);
}

/** "Semana de 14/09" ou "set/26". */
export function rotuloDoPonto(inicio: string, grao: "week" | "month"): string {
  const [a, m, d] = inicio.split("-");
  if (grao === "month") {
    const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${meses[Number(m) - 1]}/${a.slice(2)}`;
  }
  return `${d}/${m}`;
}

// -----------------------------------------------------------------------------
// Quem vê o link
// -----------------------------------------------------------------------------

/**
 * Espelho da regra do banco, para esconder o link de quem não pode abrir.
 * Admin; qualquer papel na Franqueadora; Gerente ou Franqueado de unidade.
 */
export function podeVerPainelDeRelatos(s: {
  isAdminMaster: boolean;
  clinics: { id: string; type?: string | null }[];
  rolesByClinic: Record<string, string[]>;
}): boolean {
  if (s.isAdminMaster) return true;
  return Object.entries(s.rolesByClinic).some(([clinicId, papeis]) => {
    if (papeis.length === 0) return false;
    const clinica = s.clinics.find((c) => c.id === clinicId);
    if (clinica?.type === "franchisor") return true;
    return papeis.includes("unit_manager") || papeis.includes("franchisee");
  });
}

// =============================================================================
// O PAINEL CALCULADO NO CÓDIGO (20/09/2026) — para valer nos DOIS ambientes
// =============================================================================
//
// A conta morava no banco (`system_reports_dashboard`, 0258), e ela decide o
// escopo por `auth.uid()`. Isso deixou de servir quando o dono pediu o painel
// CONSOLIDADO (sistema + treino): os relatos do treino estão em outro banco, e
// lá dentro ninguém está logado — a chave de serviço não tem `auth.uid()`.
//
// Duas saídas existiam: um painel por ambiente, ou refazer a conta aqui com as
// linhas dos dois bancos. O dono escolheu a segunda, e ela tem uma vantagem que
// a outra não tinha: a MEDIANA de verdade. Mediana de dois conjuntos não se
// soma — só se calcula sobre as linhas juntas.
//
// ⚠️ AS REGRAS SÃO AS MESMAS DA 0258, repetidas aqui de propósito e presas por
// teste:
//   * o período filtra pela data em que o relato foi REGISTRADO (Brasília);
//   * "respostas enviadas" conta respostas ESCRITAS no período;
//   * tempo até a 1ª resposta e até a conclusão usam só quem chegou lá;
//   * "aproveitado" = resolvido ("não é defeito" é participação, não acerto);
//   * os rankings deixam de fora os relatos do Admin Master;
//   * "parados" é o que está aberto AGORA, de qualquer data, sem o título.
//
// ⚠️ O ESCOPO (rede × unidades) é decidido no servidor ANTES de chamar esta
// função — ver `painel-dados.ts`. Guarda esquecida entrega dado a quem pedir
// (lição da 0227).

export type RelatoCru = {
  code: string;
  kind: TipoDeRelato;
  status: SituacaoDeRelato;
  modulo: ModuloDoSistema | null;
  clinicId: string;
  clinicNome: string;
  reporterId: string;
  reporterNome: string;
  reporterPapel: string | null;
  /** Relato do Admin Master fica fora dos rankings (ele é quem corrige). */
  reporterEhAdmin: boolean;
  criadoEm: string;
  primeiraRespostaEm: string | null;
  encerradoEm: string | null;
  reaberturas: number;
  ambiente: "sistema" | "treino";
};

/** Uma resposta do suporte, para a contagem de "respostas enviadas". */
export type RespostaCrua = { criadaEm: string; clinicId: string };

const ENCERRADOS: SituacaoDeRelato[] = ["resolvido", "nao_e_defeito"];
const ABERTOS: SituacaoDeRelato[] = ["aberto", "em_analise"];

/** A data civil brasileira de um instante — a mesma régua da 0258. */
function diaBr(iso: string): string {
  return isoDateIn(new Date(iso));
}

function horasEntre(de: string, ate: string): number {
  return (Date.parse(ate) - Date.parse(de)) / 3_600_000;
}

function arredondar1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * A MESMA mediana do Postgres (`percentile_cont`): interpola entre os dois
 * vizinhos quando o conjunto é par.
 */
export function medianaInterpolada(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const pos = 0.5 * (v.length - 1);
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (baixo === alto) return v[baixo];
  return v[baixo] + (v[alto] - v[baixo]) * (pos - baixo);
}

/** O começo da semana (segunda) ou do mês — como o `date_trunc` do Postgres. */
export function inicioDoBalde(isoDate: string, grao: "week" | "month"): string {
  if (grao === "month") return `${isoDate.slice(0, 7)}-01`;
  const dia = weekdayOf(isoDate); // 0=domingo … 6=sábado
  return addDaysIso(isoDate, -((dia + 6) % 7));
}

function proximoBalde(isoDate: string, grao: "week" | "month"): string {
  if (grao === "week") return addDaysIso(isoDate, 7);
  const [a, m] = isoDate.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

export type EntradaDoPainel = {
  relatos: RelatoCru[];
  respostas: RespostaCrua[];
  periodo: { de: string; ate: string };
  /** Rede = Admin/Franqueadora (com ranking de pessoas). */
  rede: boolean;
  /** Unidades do escopo; `null` = a rede inteira. */
  unidades: string[] | null;
  /** As unidades que o filtro da tela oferece. */
  unidadesDoEscopo: { id: string; nome: string }[];
};

export function montarPainel(e: EntradaDoPainel): PainelDeRelatos {
  const noEscopo = (clinicId: string) =>
    e.unidades === null || e.unidades.includes(clinicId);
  const grao: "week" | "month" =
    (Date.parse(e.periodo.ate) - Date.parse(e.periodo.de)) / 86_400_000 > 120
      ? "month"
      : "week";

  const doEscopo = e.relatos.filter((r) => noEscopo(r.clinicId));
  const base = doEscopo.filter((r) => {
    const dia = diaBr(r.criadoEm);
    return dia >= e.periodo.de && dia <= e.periodo.ate;
  });
  const ranking = base.filter((r) => !r.reporterEhAdmin);

  const conta = (f: (r: RelatoCru) => boolean) => base.filter(f).length;
  const respondidos = base.filter((r) => r.primeiraRespostaEm !== null);
  const concluidos = base.filter(
    (r) => r.encerradoEm !== null && ENCERRADOS.includes(r.status)
  );
  const horasResposta = respondidos.map((r) =>
    horasEntre(r.criadoEm, r.primeiraRespostaEm as string)
  );
  const horasConclusao = concluidos.map((r) =>
    horasEntre(r.criadoEm, r.encerradoEm as string)
  );

  const modulos = new Map<string, PainelDeRelatos["por_modulo"][number]>();
  for (const r of base) {
    const chave = r.modulo ?? "sem";
    const linha = modulos.get(chave) ?? {
      modulo: chave as ModuloDoSistema | "sem",
      relatos: 0,
      sugestoes: 0,
      implantadas: 0,
      erros: 0,
      erros_resolvidos: 0,
      duvidas: 0,
    };
    linha.relatos++;
    if (r.kind === "sugestao") {
      linha.sugestoes++;
      if (r.status === "resolvido") linha.implantadas++;
    }
    if (r.kind === "erro") {
      linha.erros++;
      if (r.status === "resolvido") linha.erros_resolvidos++;
    }
    if (r.kind === "duvida") linha.duvidas++;
    modulos.set(chave, linha);
  }

  type LinhaDeUnidade = PainelDeRelatos["por_unidade"][number] & {
    quem: Set<string>;
  };
  type LinhaDePessoa = NonNullable<PainelDeRelatos["por_pessoa"]>[number] & {
    unidadesSet: Set<string>;
    ultimo: string;
  };
  const unidades = new Map<string, LinhaDeUnidade>();
  const pessoas = new Map<string, LinhaDePessoa>();

  for (const r of ranking) {
    const u = unidades.get(r.clinicId) ?? {
      clinic_id: r.clinicId,
      nome: r.clinicNome,
      relatos: 0,
      aproveitados: 0,
      sugestoes: 0,
      implantadas: 0,
      pessoas: 0,
      quem: new Set<string>(),
    };
    u.relatos++;
    if (r.status === "resolvido") u.aproveitados++;
    if (r.kind === "sugestao") {
      u.sugestoes++;
      if (r.status === "resolvido") u.implantadas++;
    }
    u.quem.add(r.reporterId);
    unidades.set(r.clinicId, u);

    const p = pessoas.get(r.reporterId) ?? {
      reporter_id: r.reporterId,
      nome: r.reporterNome || "—",
      papel: r.reporterPapel,
      unidades: "",
      relatos: 0,
      aproveitados: 0,
      sugestoes: 0,
      implantadas: 0,
      unidadesSet: new Set<string>(),
      ultimo: r.criadoEm,
    };
    p.relatos++;
    if (r.status === "resolvido") p.aproveitados++;
    if (r.kind === "sugestao") {
      p.sugestoes++;
      if (r.status === "resolvido") p.implantadas++;
    }
    p.unidadesSet.add(r.clinicNome);
    // O papel é o do relato MAIS RECENTE: a pessoa pode ter mudado de função.
    if (r.criadoEm >= p.ultimo) {
      p.ultimo = r.criadoEm;
      p.papel = r.reporterPapel;
    }
    pessoas.set(r.reporterId, p);
  }

  const parados = doEscopo
    .filter((r) => ABERTOS.includes(r.status))
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
    .slice(0, 10)
    .map((r) => ({
      code: r.code,
      kind: r.kind,
      status: r.status,
      modulo: (r.modulo ?? "sem") as ModuloDoSistema | "sem",
      unidade: r.clinicNome,
      criado_em: r.criadoEm,
      sem_resposta: r.primeiraRespostaEm === null,
      reopened_count: r.reaberturas,
    }));

  const serie: PainelDeRelatos["serie"] = [];
  for (
    let inicio = inicioDoBalde(e.periodo.de, grao);
    inicio <= e.periodo.ate;
    inicio = proximoBalde(inicio, grao)
  ) {
    const fim = proximoBalde(inicio, grao);
    const piso = inicio > e.periodo.de ? inicio : e.periodo.de;
    serie.push({
      inicio,
      relatados: base.filter((r) => {
        const dia = diaBr(r.criadoEm);
        return dia >= inicio && dia < fim;
      }).length,
      concluidos: doEscopo.filter((r) => {
        if (!r.encerradoEm || !ENCERRADOS.includes(r.status)) return false;
        const dia = diaBr(r.encerradoEm);
        return dia >= piso && dia < fim && dia <= e.periodo.ate;
      }).length,
    });
  }

  return {
    escopo: { rede: e.rede, grao, unidades: e.unidadesDoEscopo },
    totais: {
      relatos: base.length,
      erros: conta((r) => r.kind === "erro"),
      erros_resolvidos: conta((r) => r.kind === "erro" && r.status === "resolvido"),
      erros_nao_defeito: conta(
        (r) => r.kind === "erro" && r.status === "nao_e_defeito"
      ),
      duvidas: conta((r) => r.kind === "duvida"),
      duvidas_respondidas: conta(
        (r) => r.kind === "duvida" && r.primeiraRespostaEm !== null
      ),
      sugestoes: conta((r) => r.kind === "sugestao"),
      sugestoes_implantadas: conta(
        (r) => r.kind === "sugestao" && r.status === "resolvido"
      ),
      sugestoes_recusadas: conta(
        (r) => r.kind === "sugestao" && r.status === "nao_e_defeito"
      ),
      em_aberto: conta((r) => ABERTOS.includes(r.status)),
      sem_resposta: conta(
        (r) => ABERTOS.includes(r.status) && r.primeiraRespostaEm === null
      ),
      reabertos: conta((r) => r.reaberturas > 0),
    },
    respostas_enviadas: e.respostas.filter((m) => {
      const dia = diaBr(m.criadaEm);
      return noEscopo(m.clinicId) && dia >= e.periodo.de && dia <= e.periodo.ate;
    }).length,
    tempos: {
      resposta_media_h: arredondar1(media(horasResposta)),
      resposta_mediana_h: arredondar1(medianaInterpolada(horasResposta)),
      respondidos: respondidos.length,
      conclusao_media_h: arredondar1(media(horasConclusao)),
      conclusao_mediana_h: arredondar1(medianaInterpolada(horasConclusao)),
      concluidos: concluidos.length,
      // Encerrados antes da 0256 não têm data de conclusão: ficam de fora da
      // média, e a tela diz quantos são.
      concluidos_sem_data: base.filter(
        (r) => r.encerradoEm === null && ENCERRADOS.includes(r.status)
      ).length,
    },
    por_modulo: [...modulos.values()].sort(
      (a, b) => b.relatos - a.relatos || a.modulo.localeCompare(b.modulo)
    ),
    por_unidade: [...unidades.values()]
      .map(({ quem, ...u }) => ({ ...u, pessoas: quem.size }))
      .sort(
        (a, b) =>
          b.aproveitados - a.aproveitados ||
          b.relatos - a.relatos ||
          a.nome.localeCompare(b.nome)
      ),
    // Só para a rede (decisão do dono): unidade não vê ranking de pessoas.
    por_pessoa: e.rede
      ? [...pessoas.values()]
          .map((p) => ({
            reporter_id: p.reporter_id,
            nome: p.nome,
            papel: p.papel,
            unidades: [...p.unidadesSet].sort().join(", "),
            relatos: p.relatos,
            aproveitados: p.aproveitados,
            sugestoes: p.sugestoes,
            implantadas: p.implantadas,
          }))
          .sort(
            (a, b) =>
              b.aproveitados - a.aproveitados ||
              b.relatos - a.relatos ||
              a.nome.localeCompare(b.nome)
          )
          .slice(0, 10)
      : null,
    parados,
    serie,
  };
}
