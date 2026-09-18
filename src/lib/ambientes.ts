// OS TRÊS AMBIENTES (0259) — regras puras, espelho do que o banco decide.
//
// O Risartano tem UM ponto de partida: a tela de Início do sistema real. De lá
// ele vai para o riSZon Treino ou para o Risarte Academy, conforme o que estiver
// liberado para ele. Quem ainda não foi liberado no sistema real entra, vê o
// Início e nada mais — e é por ali que começa o treinamento.
//
// A régua de verdade é a do banco (`environment_allowed`). Aqui fica a mesma
// regra para a tela decidir o que desenhar sem ir ao banco duas vezes — e o
// teste prende as duas ao mesmo comportamento.

export const AMBIENTES = ["sistema", "treino", "academy"] as const;
export type Ambiente = (typeof AMBIENTES)[number];

export const AMBIENTE_ROTULO: Record<Ambiente, string> = {
  sistema: "riSZon",
  treino: "riSZon Treino",
  academy: "Risarte Academy",
};

export const AMBIENTE_DESCRICAO: Record<Ambiente, string> = {
  sistema: "O sistema do dia a dia: agenda, prontuário, jornada, financeiro.",
  treino:
    "O mesmo sistema, com dados de mentira. É onde se aprende sem medo de errar.",
  academy: "Cursos, vídeos, provas e certificados da rede.",
};

/** O que cada interruptor significa na ficha do Risartano. */
export const AMBIENTE_AJUDA: Record<Ambiente, string> = {
  sistema:
    "Libera o sistema de verdade. Sem isto a pessoa entra e vê só a tela de Início.",
  treino:
    "Cria o login dela no ambiente de treino, com o mesmo e-mail e a mesma senha.",
  academy: "Libera os cursos, as provas e os certificados.",
};

export type PermissoesDeAmbiente = Partial<Record<Ambiente, boolean>>;

/**
 * ESPELHO DE `environment_allowed` (0259).
 *
 * Sem decisão registrada: treino e Academy ficam **liberados** (são os
 * ambientes de aprender — o dono pediu que estejam sempre disponíveis, salvo
 * retirada), e o **sistema real fica fechado** até alguém liberar. Admin Master
 * nunca se tranca para fora.
 */
export function ambientePermitido(
  permissoes: PermissoesDeAmbiente,
  ambiente: Ambiente,
  isAdminMaster = false
): boolean {
  if (isAdminMaster) return true;
  const registrado = permissoes[ambiente];
  if (registrado !== undefined) return registrado;
  return ambiente !== "sistema";
}

export type CartaoDeAmbiente = {
  ambiente: Ambiente;
  rotulo: string;
  descricao: string;
  url: string;
};

/**
 * Os atalhos que aparecem no Início.
 *
 * Três razões para um ambiente NÃO virar cartão, e as três são diferentes:
 *   1. é o ambiente em que a pessoa já está (atalho para si mesmo não existe);
 *   2. ela não tem acesso a ele;
 *   3. **ele ainda não tem endereço** — o Academy ainda não foi publicado, e um
 *      cartão que leva a lugar nenhum é pior que cartão nenhum.
 */
export function cartoesDoInicio(entrada: {
  permissoes: PermissoesDeAmbiente;
  urls: Partial<Record<Ambiente, string | null>>;
  atual: Ambiente;
  isAdminMaster?: boolean;
}): CartaoDeAmbiente[] {
  return AMBIENTES.filter((a) => a !== entrada.atual)
    .filter((a) =>
      ambientePermitido(entrada.permissoes, a, entrada.isAdminMaster ?? false)
    )
    .map((a) => ({
      ambiente: a,
      rotulo: AMBIENTE_ROTULO[a],
      descricao: AMBIENTE_DESCRICAO[a],
      url: (entrada.urls[a] ?? "").trim(),
    }))
    .filter((c) => c.url !== "");
}

/**
 * O NOME DA ABA de cada ambiente.
 *
 * Sem nome, todo clique no atalho abre uma aba nova — e em cinco idas e voltas
 * a pessoa está com seis abas do mesmo sistema (relato do dono, 17/09/2026).
 * Com nome, o navegador **reaproveita** a aba daquele ambiente e a traz para a
 * frente. Cada aba também assume o próprio nome ao carregar (`NomeDaAba`), para
 * o atalho de volta encontrar a aba de origem em vez de criar outra.
 */
export function nomeDaAba(ambiente: Ambiente): string {
  return `risarte-${ambiente}`;
}

/**
 * O endereço é digitado por gente, então é conferido antes de virar link:
 * só `http`/`https`, e o resto vira "sem endereço" em vez de um link quebrado
 * (ou de um `javascript:` colado por engano).
 */
export function enderecoValido(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
