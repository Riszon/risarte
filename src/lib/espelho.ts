// O TREINO É ESPELHO DA PRODUÇÃO (0260) — as regras puras da cópia.
//
// Decisão do dono (18/09/2026): Risartanos, logins, funções, ambientes e
// permissões se criam e se alteram SÓ na produção; o treino recebe a cópia e
// só deixa consultar. Aqui ficam as contas que decidem O QUE a cópia grava —
// sem banco, para serem testadas. Quem lê e grava é `espelho-treino.ts`.

/** Os três ambientes de 0259, na ordem da tela. */
export const AMBIENTES_DO_ESPELHO = ["sistema", "treino", "academy"] as const;
export type AmbienteDoEspelho = (typeof AMBIENTES_DO_ESPELHO)[number];

export type LinhaDeAmbiente = { environment: string; allowed: boolean };

/**
 * A MESMA regra de `environment_allowed` (0259), para a produção:
 * Admin Master entra em tudo; sem linha, treino e Academy ficam liberados e o
 * sistema real fica fechado (ele é liberado de propósito).
 */
export function permitidoNaProducao(
  isAdminMaster: boolean,
  linhas: LinhaDeAmbiente[],
  ambiente: AmbienteDoEspelho
): boolean {
  if (isAdminMaster) return true;
  const linha = linhas.find((l) => l.environment === ambiente);
  return linha ? linha.allowed : ambiente !== "sistema";
}

/**
 * O que a pessoa pode no TREINO, a partir do que ela pode na produção.
 *
 * O ponto que não é óbvio: lá dentro, "sistema" é o próprio treino. Quem está
 * liberado para treinar precisa encontrar o sistema ABERTO no treino — senão o
 * recém-chegado, que ainda não tem o sistema real (é exatamente quem mais
 * precisa treinar), cairia no modo portal do treino e não teria o que treinar.
 */
export function ambientesNoTreino(
  isAdminMaster: boolean,
  linhas: LinhaDeAmbiente[]
): Record<AmbienteDoEspelho, boolean> {
  const treino = permitidoNaProducao(isAdminMaster, linhas, "treino");
  return {
    sistema: treino,
    treino,
    academy: permitidoNaProducao(isAdminMaster, linhas, "academy"),
  };
}

/**
 * O login do treino fica aberto só para quem está ativo E liberado no treino.
 * Nos outros casos ele existe (para a lista mostrar o acesso), mas bloqueado.
 */
export function loginAbertoNoTreino(entrada: {
  ativo: boolean;
  isAdminMaster: boolean;
  linhas: LinhaDeAmbiente[];
}): boolean {
  return (
    entrada.ativo &&
    permitidoNaProducao(entrada.isAdminMaster, entrada.linhas, "treino")
  );
}

/**
 * Traduz uma lista de ids da produção para os ids do treino. O que não tem
 * correspondente sai da lista e volta em `faltando` — a cópia avisa em vez de
 * inventar.
 */
export function traduzirIds(
  ids: readonly string[],
  mapa: ReadonlyMap<string, string | null>
): { ids: string[]; faltando: string[] } {
  const saida: string[] = [];
  const faltando: string[] = [];
  for (const id of ids) {
    const local = mapa.get(id);
    if (local) {
      if (!saida.includes(local)) saida.push(local);
    } else {
      faltando.push(id);
    }
  }
  return { ids: saida, faltando };
}

/**
 * A foto mora na pasta da UNIDADE (`<clinic_id>/arquivo`), e o id da unidade é
 * outro no treino. Troca só o primeiro pedaço; o nome do arquivo fica igual.
 * Caminho fora do padrão vai inteiro para dentro da pasta da unidade de lá.
 */
export function caminhoDaFotoNoTreino(
  caminho: string,
  unidadeLocal: string
): string {
  const barra = caminho.indexOf("/");
  const arquivo = barra >= 0 ? caminho.slice(barra + 1) : caminho;
  return `${unidadeLocal}/${arquivo}`;
}

/**
 * Mensagem de falha que pode ser guardada e mostrada: o PASSO e o CÓDIGO do
 * erro, nunca o texto do banco. O texto do Postgres repete valores
 * ("Key (cpf)=(…) already exists") — e CPF não vai para tela nem para log.
 */
export function falhaSemDados(passo: string, codigo?: string | null): string {
  return codigo ? `${passo} (código ${codigo})` : passo;
}

/** Campos da ficha que são ids de pessoa na produção e mudam no treino. */
export const CAMPOS_DE_PESSOA = ["user_id", "created_by", "updated_by"] as const;

/**
 * A linha do Risartano como ela deve ficar no treino.
 *
 * Copia TODAS as colunas (coluna nova entra sozinha, sem mexer aqui) e troca só
 * as que apontam para outra tabela: unidade, unidades inativas, pessoas e foto.
 * O id é o MESMO da produção — é ele que liga as duas cópias.
 */
export function linhaDoRisartanoNoTreino(
  linha: Record<string, unknown>,
  ctx: {
    unidadeLocal: string;
    unidades: ReadonlyMap<string, string | null>;
    pessoas: ReadonlyMap<string, string | null>;
    agora: string;
  }
): { linha: Record<string, unknown>; unidadesFaltando: string[] } {
  const saida: Record<string, unknown> = { ...linha };
  saida.clinic_id = ctx.unidadeLocal;

  const inativas = traduzirIds(
    (linha.inactive_unit_ids as string[] | null) ?? [],
    ctx.unidades
  );
  saida.inactive_unit_ids = inativas.ids;

  for (const campo of CAMPOS_DE_PESSOA) {
    const origem = linha[campo] as string | null | undefined;
    saida[campo] = origem ? ctx.pessoas.get(origem) ?? null : null;
  }

  const foto = linha.photo_path as string | null | undefined;
  saida.photo_path = foto ? caminhoDaFotoNoTreino(foto, ctx.unidadeLocal) : null;
  saida.mirrored_at = ctx.agora;

  return { linha: saida, unidadesFaltando: inativas.faltando };
}

/**
 * A resposta de toda ação de Risartanos, acessos e permissões DENTRO do treino.
 * A tela já esconde os botões; esta é a segunda barreira (a terceira é o banco,
 * 0260) e o texto diz o que fazer em vez de só dizer "não".
 */
export const SOMENTE_CONSULTA_NO_TREINO =
  "No treino, Risartanos, acessos e permissões são só para consulta. Faça a alteração no sistema real — ela chega aqui sozinha.";

/**
 * O NÍVEL DE CARREIRA DO DENTISTA É DO TREINO (0261).
 *
 * Ele mora no registro da função, que a cópia regrava inteiro — mas não é
 * acesso, é configuração financeira de cada ambiente (como as tabelas de
 * repasse). Antes de regravar, a cópia guarda o nível de cada função que já
 * existe lá; a função que volta igual (mesma unidade, mesmo papel) volta com
 * ele. Função que mudou de papel não herda: o nível era de outro papel.
 */
export function niveisDeCarreiraDoTreino(
  linhas: { clinic_id: string; role: string; career_level_id: string | null }[]
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const l of linhas) {
    if (l.career_level_id) mapa.set(`${l.clinic_id}|${l.role}`, l.career_level_id);
  }
  return mapa;
}

export function nivelPreservado(
  niveis: ReadonlyMap<string, string>,
  clinicId: string,
  role: string
): string | null {
  return niveis.get(`${clinicId}|${role}`) ?? null;
}
