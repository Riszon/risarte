// O "VOLTAR" DA BARRA DE CIMA (relato OC-00101, 14/10/2026).
//
// "Para retornar à tela anterior temos que clicar no Início e ir passando as
// páginas até chegar onde pretendo." A seta do navegador já fazia isso; faltava
// um botão no próprio sistema. Decisão do dono: uma seta fixa na barra de cima,
// que volta à tela ANTERIOR (não à "tela mãe") do jeito que ela estava.
//
// Esta regra decide quando a seta acende: só quando a tela anterior é uma tela
// do riSZon. Voltar para o login (que manda para dentro de novo), para a tela
// de conta desativada ou para fora do sistema não é voltar — é sair.

/** Endereços que não contam como "tela anterior" mesmo sendo do riSZon. */
const NAO_E_TELA_DE_TRABALHO = ["/login", "/auth", "/conta-desativada"];

/** A tela anterior serve para o "Voltar"? Sem tela anterior, não. */
export function anteriorServeParaVoltar(
  urlAnterior: string | null | undefined,
  origemAtual: string
): boolean {
  if (!urlAnterior) return false;
  let url: URL;
  try {
    url = new URL(urlAnterior);
  } catch {
    return false;
  }
  if (url.origin !== origemAtual) return false;
  return !NAO_E_TELA_DE_TRABALHO.some(
    (p) => url.pathname === p || url.pathname.startsWith(`${p}/`)
  );
}
