/**
 * OS ÍNDICES DAS LINHAS QUE VIERAM NUM FORMULÁRIO (`proc_0`, `proc_1`, …).
 *
 * ⚠️ NUNCA UM TETO FIXO. As listas eram lidas com `for (i = 0; i < 200; …)`,
 * e a linha 201 em diante era DESCARTADA EM SILÊNCIO: o padrão da rede chegou
 * a 307 benefícios, a proposta mostrava os 307 na tela e gravava 200 (relato
 * do dono, 28/10/2026). Aqui se lê o que o formulário realmente mandou, em
 * ordem, sem limite e sem buraco quebrar a contagem.
 */
export function indicesDoFormulario(formData: FormData, prefixo: string): number[] {
  const indices = new Set<number>();
  const padrao = new RegExp(`^${prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  for (const chave of formData.keys()) {
    const m = padrao.exec(chave);
    if (m) indices.add(Number(m[1]));
  }
  return [...indices].sort((a, z) => a - z);
}
