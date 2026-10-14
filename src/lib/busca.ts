// BUSCA DE TEXTO — uma regra só para todo campo de procurar do sistema.
//
// Sem acento e sem caixa ("relatorio" acha "Relatórios"), e por PALAVRAS: cada
// palavra digitada precisa aparecer em algum lugar do texto, em qualquer
// ordem ("resina a2" acha "Resina composta A2"). É a mesma régua da tela de
// Permissões (OC-00002) e das listas com busca (OC-00100).

/** Sem acento, minúsculo, sem espaço nas pontas. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    // Os acentos soltos pelo NFD. Escritos com \u de propósito: o caractere
    // literal é invisível no editor e já se perdeu uma vez numa cópia.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** O texto atende à busca? Busca vazia atende a tudo. */
export function atendeABusca(texto: string, busca: string): boolean {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const alvo = normalizar(texto);
  return termos.every((t) => alvo.includes(t));
}
