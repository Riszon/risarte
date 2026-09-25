// RISARTANOS — a equipe num lugar só (cadastro + acesso ao sistema).
//
// Até a v0.250.0 a mesma pessoa vivia em duas telas: "Risartanos" (o cadastro
// de RH) e "Usuários (acesso)" (o login e as funções). Quem entrava numa não
// via a outra, e um colaborador desligado podia continuar com login ativo sem
// que ninguém percebesse — a informação existia, só não estava junta.
//
// Aqui ficam as regras PURAS dessa união: como se lê a situação do acesso de
// alguém, como se filtra e busca na lista, e como se monta/entende o endereço
// de uma ficha. Quem manda em quem PODE o quê continua sendo a RLS do banco e
// as guardas das telas — isto aqui não decide permissão nenhuma.

/** Uma pessoa na lista: o cadastro, o login, ou os dois. */
export type PessoaDaEquipe = {
  /** `risartano` tem cadastro; `login` é um acesso sem cadastro de RH. */
  tipo: "risartano" | "login";
  /** Chave de lista (id do cadastro ou id do login). */
  chave: string;
  /** Endereço da ficha (`/risartanos/RIS-0001` ou `/risartanos/acesso/<id>`). */
  href: string;
  code: string | null;
  nome: string;
  /**
   * A FUNÇÃO PREVISTA NO CADASTRO (`staff_members.role_title`), já com o
   * rótulo em português. A lista mostrava "sem função definida" para quem
   * ainda não tem acesso — mesmo com a função escolhida no cadastro (queixa do
   * dono, 21/09/2026). Função prevista NÃO é função de acesso: uma diz o que a
   * pessoa veio fazer; a outra, o que o login abre.
   */
  funcaoPrevista: string | null;
  nomeCompleto: string;
  email: string | null;
  cpf: string | null;
  fotoUrl: string | null;
  /** Unidade de origem do cadastro (onde ele foi criado). */
  unidadeOrigem: string | null;
  unidadeOrigemId: string | null;
  /** Unidades onde a pessoa tem função, vindas do acesso. */
  unidades: {
    clinicId: string;
    clinicName: string;
    roleLabel: string;
    inativo: boolean;
    gerida: boolean;
  }[];
  regime: string | null;
  /** Cadastro ativo (RH). Login sem cadastro entra como ativo. */
  ativo: boolean;
  /** Tem login? */
  temAcesso: boolean;
  /** O login está liberado para entrar? */
  acessoAtivo: boolean;
  isAdminMaster: boolean;
  /** Quem vê pode editar esta pessoa? */
  podeGerir: boolean;
};

// -----------------------------------------------------------------------------
// A situação do acesso
// -----------------------------------------------------------------------------

export const SITUACOES_DE_ACESSO = [
  "com_acesso",
  "sem_acesso",
  "acesso_desativado",
  "login_orfao",
  "cadastro_incompleto",
] as const;
export type SituacaoDeAcesso = (typeof SITUACOES_DE_ACESSO)[number];

export const ACESSO_ROTULO: Record<SituacaoDeAcesso, string> = {
  com_acesso: "Com acesso",
  sem_acesso: "Sem acesso",
  acesso_desativado: "Acesso desativado",
  login_orfao: "Login ainda ativo",
  cadastro_incompleto: "Cadastro incompleto",
};

export const ACESSO_EXPLICACAO: Record<SituacaoDeAcesso, string> = {
  com_acesso: "Entra no sistema normalmente.",
  sem_acesso: "Está no cadastro, mas não tem login.",
  acesso_desativado: "Tem login, mas ele está bloqueado.",
  login_orfao: "Saiu da equipe e o login continua entrando — resolva primeiro.",
  cadastro_incompleto: "Entra no sistema, mas não tem cadastro de Risartano.",
};

/**
 * A situação de UMA pessoa. `login_orfao` vem primeiro de propósito: colaborador
 * inativo com login ativo é o único caso aqui que é risco, não informação.
 */
export function situacaoDeAcesso(p: {
  tipo: "risartano" | "login";
  ativo: boolean;
  temAcesso: boolean;
  acessoAtivo: boolean;
}): SituacaoDeAcesso {
  if (p.tipo === "login") return "cadastro_incompleto";
  if (!p.temAcesso) return "sem_acesso";
  if (!p.ativo && p.acessoAtivo) return "login_orfao";
  if (!p.acessoAtivo) return "acesso_desativado";
  return "com_acesso";
}

// -----------------------------------------------------------------------------
// Filtros da lista
// -----------------------------------------------------------------------------

export const FILTROS_DE_ACESSO = [
  { value: "", label: "Todo mundo" },
  { value: "com_acesso", label: "Com acesso" },
  { value: "sem_acesso", label: "Sem acesso" },
  { value: "acesso_desativado", label: "Acesso desativado" },
  { value: "atencao", label: "Precisa de atenção" },
] as const;

export type FiltroDeAcesso = (typeof FILTROS_DE_ACESSO)[number]["value"];

export const SITUACOES_DE_CADASTRO = [
  { value: "ativos", label: "Ativos" },
  { value: "inativos", label: "Inativos" },
  { value: "todos", label: "Todos" },
] as const;

export type SituacaoDeCadastro = (typeof SITUACOES_DE_CADASTRO)[number]["value"];

export type FiltrosDaEquipe = {
  busca: string;
  unidade: string;
  contrato: string;
  situacao: SituacaoDeCadastro;
  acesso: FiltroDeAcesso;
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Lê os filtros do endereço. Valor que não existe vira o padrão em vez de
 * derrubar a tela — lição do filtro de Recebíveis (OC-00009).
 */
export function lerFiltros(
  params: Record<string, string | string[] | undefined>,
  contratosValidos: readonly string[]
): FiltrosDaEquipe {
  const situacao = texto(params.situacao);
  const acesso = texto(params.acesso);
  const contrato = texto(params.contrato);
  return {
    busca: texto(params.busca),
    unidade: texto(params.unidade),
    contrato: contratosValidos.includes(contrato) ? contrato : "",
    situacao: (SITUACOES_DE_CADASTRO.find((s) => s.value === situacao)?.value ??
      "ativos") as SituacaoDeCadastro,
    acesso: (FILTROS_DE_ACESSO.find((f) => f.value === acesso)?.value ??
      "") as FiltroDeAcesso,
  };
}

/** Busca por nome, apelido, e-mail, CPF ou código — sem acento nem maiúscula. */
export function casaBusca(p: PessoaDaEquipe, termo: string): boolean {
  const t = normalizar(termo);
  if (!t) return true;
  return [p.nome, p.nomeCompleto, p.email, p.cpf, p.code]
    .filter(Boolean)
    .some((campo) => normalizar(campo as string).includes(t));
}

export function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** "Precisa de atenção" = login de quem saiu da equipe, ou acesso sem cadastro. */
export function precisaDeAtencao(p: PessoaDaEquipe): boolean {
  const s = situacaoDeAcesso(p);
  return s === "login_orfao" || s === "cadastro_incompleto";
}

export function passaNoFiltro(p: PessoaDaEquipe, f: FiltrosDaEquipe): boolean {
  if (!casaBusca(p, f.busca)) return false;
  if (f.contrato && p.regime !== f.contrato) return false;
  if (f.unidade) {
    const naUnidade =
      p.unidadeOrigemId === f.unidade ||
      p.unidades.some((u) => u.clinicId === f.unidade);
    if (!naUnidade) return false;
  }
  // O cadastro incompleto é um LOGIN: "ativos/inativos" fala do cadastro de RH,
  // que ele não tem. Ele só sai da lista quando se pede "inativos".
  if (f.situacao === "ativos" && !p.ativo) return false;
  if (f.situacao === "inativos" && (p.ativo || p.tipo === "login")) return false;
  if (f.acesso === "atencao") return precisaDeAtencao(p);
  if (f.acesso) return situacaoDeAcesso(p) === f.acesso;
  return true;
}

/** Os números dos atalhos do topo. Sempre sobre a lista JÁ visível a quem olha. */
export function contarEquipe(pessoas: PessoaDaEquipe[]) {
  let comAcesso = 0;
  let semAcesso = 0;
  let atencao = 0;
  let inativos = 0;
  for (const p of pessoas) {
    const s = situacaoDeAcesso(p);
    if (s === "com_acesso") comAcesso += 1;
    if (s === "sem_acesso") semAcesso += 1;
    if (precisaDeAtencao(p)) atencao += 1;
    if (p.tipo === "risartano" && !p.ativo) inativos += 1;
  }
  return { total: pessoas.length, comAcesso, semAcesso, atencao, inativos };
}

/**
 * A ordem da lista, em três degraus:
 *   1. login de quem SAIU da equipe — é risco, e risco vai para cima;
 *   2. a equipe, por nome — é o que se vem procurar aqui;
 *   3. login sem cadastro — é tarefa, e tarefa espera no fim.
 * Misturar 1 e 3 num "precisa de atenção" só faria a equipe de verdade
 * começar embaixo de uma lista de pendências.
 */
export function ordenar(pessoas: PessoaDaEquipe[]): PessoaDaEquipe[] {
  const degrau = (p: PessoaDaEquipe) => {
    const s = situacaoDeAcesso(p);
    if (s === "login_orfao") return 0;
    if (s === "cadastro_incompleto") return 2;
    return 1;
  };
  return [...pessoas].sort((a, b) => {
    const d = degrau(a) - degrau(b);
    return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
  });
}

// -----------------------------------------------------------------------------
// A função prevista, o cadastro completo e a senha sugerida
// -----------------------------------------------------------------------------

/**
 * A FUNÇÃO ESCOLHIDA NO CADASTRO (`staff_members.role_title`).
 *
 * Quem manda no que a pessoa ABRE continua sendo o acesso
 * (`user_clinic_roles`) — é ele que a RLS lê. O campo do cadastro é a função
 * **prevista**: serve para dizer, na hora de cadastrar, o que a pessoa vem
 * fazer, e para chegar pronta na ficha do acesso. Guardar a função em dois
 * lugares sem essa distinção faria a tela afirmar um cargo que o banco não
 * reconhece.
 */
export const FUNCOES_DE_DENTISTA = ["dentist", "planner_dentist"] as const;

/** Só dentista tem especialidade — para os outros o bloco nem aparece. */
export function pedeEspecialidades(funcao: string | null | undefined): boolean {
  return (FUNCOES_DE_DENTISTA as readonly string[]).includes(funcao ?? "");
}

/**
 * O cadastro está completo? É o que libera a aba do Acesso.
 *
 * Um cadastro salvo hoje já nasce completo (todos estes campos são
 * obrigatórios no formulário). A régua existe para o cadastro ANTIGO, feito
 * antes de algum campo virar obrigatório: em vez de oferecer um acesso sobre
 * uma ficha pela metade, a tela diz o que falta.
 */
export const CAMPOS_DO_CADASTRO: { campo: string; rotulo: string }[] = [
  { campo: "fullName", rotulo: "Nome completo" },
  { campo: "preferredName", rotulo: "Como quer ser chamado(a)" },
  { campo: "cpf", rotulo: "CPF" },
  { campo: "birthDate", rotulo: "Nascimento" },
  { campo: "gender", rotulo: "Gênero" },
  { campo: "maritalStatus", rotulo: "Estado civil" },
  { campo: "whatsapp", rotulo: "WhatsApp" },
  { campo: "email", rotulo: "E-mail" },
  { campo: "zipCode", rotulo: "CEP" },
  { campo: "address", rotulo: "Logradouro" },
  { campo: "addressNumber", rotulo: "Número" },
  { campo: "neighborhood", rotulo: "Bairro" },
  { campo: "city", rotulo: "Cidade" },
  { campo: "state", rotulo: "UF" },
  { campo: "contractType", rotulo: "Regime de contrato" },
  { campo: "roleTitle", rotulo: "Função na unidade" },
];

/** O que ainda falta no cadastro — lista vazia = completo. */
export function faltaNoCadastro(staff: Record<string, unknown>): string[] {
  return CAMPOS_DO_CADASTRO.filter(({ campo }) => {
    const v = staff[campo];
    return v === null || v === undefined || String(v).trim() === "";
  }).map((c) => c.rotulo);
}

export function cadastroCompleto(staff: Record<string, unknown>): boolean {
  return faltaNoCadastro(staff).length === 0;
}

// Sem 0/O, 1/l/I: senha provisória é DITADA por telefone ou copiada de um
// bilhete, e esses pares são os que viram chamado de "não consigo entrar".
const LETRAS = "abcdefghjkmnpqrstuvwxyz";
const NUMEROS = "23456789";

/**
 * Uma senha provisória pronta para o Admin só conferir e liberar: três letras,
 * quatro números, três letras. Atende a regra do sistema (6+, com letra e
 * número) sem obrigar ninguém a inventar senha na hora — que é como nascem as
 * senhas iguais para a equipe inteira.
 *
 * `bytes` vem de fora (`crypto.getRandomValues`) para a função ser pura e
 * testável; ela nunca sorteia nada por conta própria.
 */
export function senhaSugerida(bytes: ArrayLike<number>): string {
  const pega = (i: number, alfabeto: string) =>
    alfabeto[(bytes[i] ?? 0) % alfabeto.length];
  const parte = (inicio: number, tamanho: number, alfabeto: string) =>
    Array.from({ length: tamanho }, (_, k) => pega(inicio + k, alfabeto)).join("");
  return parte(0, 3, LETRAS) + parte(3, 4, NUMEROS) + parte(7, 3, LETRAS);
}

export const TAMANHO_DA_SENHA_SUGERIDA = 10;

// -----------------------------------------------------------------------------
// Endereço da ficha
// -----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O CÓDIGO DA FICHA, incluindo as formas que o próprio sistema gera.
 *
 * ⚠️ O SUFIXO `-TREINO` NÃO É LIXO: quem o põe é o espelho
 * (`codigoAfastado`, em `src/lib/espelho.ts`). Ao copiar a produção para o
 * treino, uma ficha LOCAL que ocupava o mesmo número é **renomeada** para
 * liberá-lo — nada é apagado. O código vira `RIS-000007-TREINO` e, se até esse
 * estiver ocupado, `RIS-000007-TREINO-A1B2C3`.
 *
 * O padrão antigo era `^RIS-\d{1,10}$`, e recusava as duas formas. Resultado
 * (achado AP2, 25/09/2026): a ficha respondia **404** pelo endereço do código,
 * e `enderecoDaFicha` caía para o id — ou seja, o sistema **gerava um código
 * que depois se recusava a entender**. Clicando na lista ninguém tropeçava (o
 * link ia pelo id), mas o código deixava de servir como endereço, contra a
 * regra de que o código do documento nunca some (CLAUDE.md §8b).
 *
 * `espelho.test.ts` amarra os dois lados: o que `codigoAfastado` gera tem de
 * ser aceito aqui.
 */
const CODIGO = /^RIS-\d{1,10}(?:-TREINO(?:-[0-9A-Z]{1,12})?)?$/;

/**
 * O endereço prefere o CÓDIGO (`/risartanos/RIS-0007`): é ele que as pessoas
 * leem, falam e colam. Cadastro sem código ainda abre pelo id.
 */
export function enderecoDaFicha(p: { code: string | null; id: string }): string {
  return `/risartanos/${p.code && CODIGO.test(p.code) ? p.code : p.id}`;
}

/** Como procurar no banco o que veio no endereço: por código ou por id. */
export function chaveDaFicha(
  param: string
): { por: "code"; valor: string } | { por: "id"; valor: string } | null {
  const v = decodeURIComponent(param ?? "").trim();
  if (CODIGO.test(v.toUpperCase())) return { por: "code", valor: v.toUpperCase() };
  if (UUID.test(v)) return { por: "id", valor: v };
  return null;
}
