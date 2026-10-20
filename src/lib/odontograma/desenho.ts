// ODONTOGRAMA — O DESENHO (OD1, passo 4, 20/10/2026).
//
// Tudo o que decide ONDE cada coisa vai no desenho mora aqui, puro e testado;
// o componente `<Odontogram />` só desenha. Notação FDI (11–48, 51–85).
//
// A vista é a de quem olha o paciente de frente: o lado DIREITO do paciente
// (quadrantes 1, 4, 5 e 8) fica à ESQUERDA da tela. Cada coroa tem 5 faces:
//   - topo / base: na arcada de CIMA o topo é a Vestibular e a base a
//     Palatina; na de BAIXO o topo é a Lingual e a base a Vestibular (a face
//     de fora fica sempre do lado de fora do arco desenhado);
//   - esquerda / direita: a MESIAL é a face voltada para o meio da boca;
//   - centro: Oclusal (posterior) ou Incisal (anterior).
// Só vira face clicável o que o dente TEM (tabela dental_tooth_faces, 0308).

export type Denticao = "permanente" | "decidua" | "mista";

export const ROTULO_DA_DENTICAO: Record<Denticao, string> = {
  permanente: "Permanente",
  decidua: "Decídua",
  mista: "Mista",
};

export type Fileira = { arcada: "superior" | "inferior"; denticao: "permanente" | "decidua"; dentes: string[] };

const faixa = (q: number, de: number, ate: number) => {
  const passo = de <= ate ? 1 : -1;
  const lista: string[] = [];
  for (let p = de; passo > 0 ? p <= ate : p >= ate; p += passo) lista.push(`${q}${p}`);
  return lista;
};

/** As fileiras do desenho, de cima para baixo, na ordem em que aparecem. */
export function fileiras(d: Denticao): Fileira[] {
  const supPerm: Fileira = { arcada: "superior", denticao: "permanente", dentes: [...faixa(1, 8, 1), ...faixa(2, 1, 8)] };
  const supDec: Fileira = { arcada: "superior", denticao: "decidua", dentes: [...faixa(5, 5, 1), ...faixa(6, 1, 5)] };
  const infDec: Fileira = { arcada: "inferior", denticao: "decidua", dentes: [...faixa(8, 5, 1), ...faixa(7, 1, 5)] };
  const infPerm: Fileira = { arcada: "inferior", denticao: "permanente", dentes: [...faixa(4, 8, 1), ...faixa(3, 1, 8)] };
  if (d === "permanente") return [supPerm, infPerm];
  if (d === "decidua") return [supDec, infDec];
  return [supPerm, supDec, infDec, infPerm];
}

export type Lado = "topo" | "base" | "esquerda" | "direita" | "centro";

const quadrante = (dente: string) => Number(dente[0]);
const posicao = (dente: string) => Number(dente[1]);

/** Dente de cima? (quadrantes 1, 2, 5, 6) */
export function ehSuperior(dente: string): boolean {
  return [1, 2, 5, 6].includes(quadrante(dente));
}

/** Anterior = incisivo ou canino (posição 1 a 3), permanente ou decíduo. */
export function ehAnterior(dente: string): boolean {
  return posicao(dente) <= 3;
}

/** Que face fica em cada lado da coroa desenhada. */
export function faceDoLado(dente: string, lado: Lado): string {
  const sup = ehSuperior(dente);
  const ladoDireitoDoPaciente = [1, 4, 5, 8].includes(quadrante(dente));
  switch (lado) {
    case "topo":
      return sup ? "V" : "L";
    case "base":
      return sup ? "P" : "V";
    case "centro":
      return ehAnterior(dente) ? "I" : "O";
    case "direita":
      // Lado direito do paciente aparece à esquerda: o meio da boca está à direita.
      return ladoDireitoDoPaciente ? "M" : "D";
    case "esquerda":
      return ladoDireitoDoPaciente ? "D" : "M";
  }
}

/**
 * Dentição sugerida pela idade: até 5 anos, decídua; de 6 a 12, mista; dali
 * em diante, permanente. Sem data de nascimento, permanente. É só o ponto de
 * partida do desenho — quem atende troca no botão (e, na OD2, a dentição
 * passa a ser guardada no odontograma do paciente).
 */
export function denticaoPelaIdade(anos: number | null): Denticao {
  if (anos === null || !Number.isFinite(anos) || anos < 0) return "permanente";
  if (anos <= 5) return "decidua";
  if (anos <= 12) return "mista";
  return "permanente";
}

/** Anos completos numa data (aaaa-mm-dd), pela data civil. */
export function anosCompletos(nascimento: string | null, hoje: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}/.test(nascimento)) return null;
  const [a, m, d] = nascimento.slice(0, 10).split("-").map(Number);
  const [ha, hm, hd] = hoje.slice(0, 10).split("-").map(Number);
  let anos = ha - a;
  if (hm < m || (hm === m && hd < d)) anos -= 1;
  return anos;
}

// -- Marcas ---------------------------------------------------------------------

/** existente = já está no dente (achado definido ou procedimento feito);
 *  planejado = a realizar (plano); sugerido = ainda não definido pelo Planner. */
export type SituacaoDaMarca = "existente" | "planejado" | "sugerido";

export type MarcaNoDente = {
  dente: string;
  /** Faces marcadas (vazio = a marca é do dente/raiz inteiro). */
  faces: string[];
  local: "face" | "crown" | "root" | "whole_tooth" | "between_teeth";
  situacao: SituacaoDaMarca;
  codigo: string;
  simbolo: string;
  nome: string;
};

/** A convenção de cores do dono (D12): vermelho = a realizar, azul =
 *  existente/realizado, cinza = ausente; a sugestão tem contorno tracejado.
 *  A cor NUNCA é a única informação: o símbolo vai junto. */
export function corDaMarca(m: Pick<MarcaNoDente, "situacao" | "codigo">): {
  classe: "planejado" | "existente" | "ausente";
  tracejado: boolean;
} {
  const ausente = m.codigo === "A" || m.codigo === "RZ-ESFOLIADO";
  return {
    classe: m.situacao === "planejado" ? "planejado" : ausente ? "ausente" : "existente",
    tracejado: m.situacao === "sugerido",
  };
}

/** A frase que um leitor de tela diz do dente. */
export function descricaoDoDente(dente: string, nome: string, marcas: MarcaNoDente[]): string {
  const doDente = marcas.filter((m) => m.dente === dente);
  if (doDente.length === 0) return `Dente ${dente}, ${nome}: sem registro`;
  const partes = doDente.map((m) => {
    const onde = m.faces.length ? ` (faces ${m.faces.join(", ")})` : "";
    const como = m.situacao === "planejado" ? "a realizar" : m.situacao === "sugerido" ? "sugestão" : "existente";
    return `${m.nome}${onde}, ${como}`;
  });
  return `Dente ${dente}, ${nome}: ${partes.join("; ")}`;
}
