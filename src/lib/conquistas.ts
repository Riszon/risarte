import { formatAnyDateBr } from "@/lib/dates";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

/**
 * AS MEDALHAS DE CERTIFICAÇÃO (OC-00133, decisões do dono M1–M4, 26/10/2026).
 *
 * Uma regra só decide o que vira selo — a lista de Risartanos, a ficha e o
 * Início leem daqui, para nunca discordarem.
 *
 * ⚠️ O CERTIFICADO É POR FUNÇÃO (0273). Quem é recepcionista e coordenador tem
 * duas medalhas: ser boa numa não prova nada sobre a outra. E a reciclagem
 * cria um certificado NOVO — o antigo fica, e o selo conta as vezes.
 *
 * ⚠️ M4: FUNÇÃO QUE A PESSOA NÃO TEM MAIS CONTINUA À VISTA, mais clara. É
 * justamente o que serve para remanejar alguém ou cobrir um colega que faltou:
 * "ela já foi certificada na recepção".
 *
 * Só certificação, por ora (M1). Medalha de meta esbarra na R4 das Metas
 * (o resultado de cada pessoa só é visto por quem edita a meta e por ela).
 */

/** Uma linha de `training_certifications`, já lida. */
export type CertificadoLido = {
  role: UserRole;
  certifiedAt: string;
  /** Teve o Aprovar do Admin (`approved_by`); senão foi automática. */
  aprovadoPeloAdmin: boolean;
};

export type SeloDeCertificacao = {
  role: UserRole;
  rotulo: string;
  /** A certificação mais recente desta função (ISO). */
  ultimaEm: string;
  /** Quantas vezes passou (a 2ª em diante é reciclagem). */
  vezes: number;
  /** A pessoa tem esta função HOJE em alguma unidade. */
  atual: boolean;
  /** Mais recente primeiro. */
  historico: {
    em: string;
    tipo: "certificacao" | "reciclagem";
    aprovadoPeloAdmin: boolean;
  }[];
};

const ehFuncao = (r: string): r is UserRole => Object.hasOwn(ROLE_LABELS, r);

/**
 * Agrupa por função. Ordem: as funções que ela tem hoje primeiro; dentro de
 * cada grupo, a certificação mais recente primeiro.
 */
export function selosDeCertificacao(
  certificados: CertificadoLido[],
  funcoesAtuais: Iterable<UserRole>
): SeloDeCertificacao[] {
  const atuais = new Set(funcoesAtuais);
  const porFuncao = new Map<UserRole, CertificadoLido[]>();
  for (const c of certificados) {
    if (!ehFuncao(c.role) || !c.certifiedAt) continue;
    const lista = porFuncao.get(c.role) ?? [];
    lista.push(c);
    porFuncao.set(c.role, lista);
  }

  const selos: SeloDeCertificacao[] = [];
  for (const [role, lista] of porFuncao) {
    const antigaPrimeiro = [...lista].sort(
      (a, b) => Date.parse(a.certifiedAt) - Date.parse(b.certifiedAt)
    );
    const historico = antigaPrimeiro
      .map((c, i) => ({
        em: c.certifiedAt,
        tipo: (i === 0 ? "certificacao" : "reciclagem") as "certificacao" | "reciclagem",
        aprovadoPeloAdmin: c.aprovadoPeloAdmin,
      }))
      .reverse();
    selos.push({
      role,
      rotulo: ROLE_LABELS[role],
      ultimaEm: historico[0].em,
      vezes: historico.length,
      atual: atuais.has(role),
      historico,
    });
  }

  return selos.sort((a, b) => {
    if (a.atual !== b.atual) return a.atual ? -1 : 1;
    return Date.parse(b.ultimaEm) - Date.parse(a.ultimaEm);
  });
}

/** O texto do selo ao passar o mouse — a data e o que ela quer dizer. */
export function explicacaoDoSelo(s: SeloDeCertificacao): string {
  const partes = [`Certificação em ${s.rotulo} concluída em ${formatAnyDateBr(s.ultimaEm)}`];
  if (s.vezes > 1) partes.push(`${s.vezes} vezes (a última foi reciclagem)`);
  if (!s.atual) partes.push("não tem mais esta função");
  return partes.join(" · ");
}

/** O filtro "Certificado em [função]": vale também a função que ela não tem mais. */
export function certificadoEm(selos: SeloDeCertificacao[], role: UserRole): boolean {
  return selos.some((s) => s.role === role);
}

/** As funções que aparecem no filtro: só as que alguém da lista tem. */
export function funcoesCertificadas(listas: SeloDeCertificacao[][]): UserRole[] {
  const funcoes = new Set<UserRole>();
  for (const selos of listas) for (const s of selos) funcoes.add(s.role);
  return [...funcoes].sort((a, b) => ROLE_LABELS[a].localeCompare(ROLE_LABELS[b], "pt-BR"));
}
