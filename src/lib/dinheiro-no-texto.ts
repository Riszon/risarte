// AP183 (item 7): os motivos da regra comercial vêm do banco com o valor no
// formato do Postgres ("R$ 140.00"). Na tela, o valor sai em reais
// ("R$ 140,00"; "R$ 1.234,50"). Só mexe no que está logo depois de "R$ ".

export function dinheiroNoTexto(texto: string): string {
  return texto.replace(/R\$\s?(\d+)\.(\d{1,2})(?!\d)/g, (_m, inteiro: string, centavos: string) => {
    const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `R$ ${milhar},${centavos.padEnd(2, "0")}`;
  });
}
