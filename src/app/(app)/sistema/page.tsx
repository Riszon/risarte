import { redirect } from "next/navigation";

/**
 * `/sistema` NÃO É MAIS UMA TELA — é uma placa apontando o caminho novo.
 *
 * Em 08/09/2026 a tela foi partida em duas (`/alertas` e `/problemas`) por
 * ordem do dono: os dois ícones da barra de cima abriam a MESMA página mudando
 * só a aba selecionada, e isso *"dá impressão de gambiarra"*.
 *
 * **Por que o arquivo continua existindo.** O endereço antigo já está solto no
 * mundo: a tela de erro (`(app)/error.tsx`) o carrega em toda aba que já estava
 * aberta antes desta versão, e ele pode ter sido colado numa conversa. Apagar a
 * rota transformaria esses links num 404 — e 404 no botão "Registrar este
 * problema" derruba justamente o caminho de quem já está com um problema na
 * mão.
 *
 * A tradução respeita a intenção de quem clicou: quem pedia a aba de alertas
 * vai para os alertas; **o resto vai para problemas**, que era o destino padrão
 * do endereço sem aba. Os parâmetros do relato (`relatar`, `tela`, `digest`)
 * viajam junto — sem eles o formulário abriria em branco e a pessoa teria de
 * redigitar o que o sistema já sabia.
 */
export default async function SistemaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  if (um(params.aba) === "alertas") redirect("/alertas");

  const levar = new URLSearchParams();
  for (const chave of ["relatar", "tela", "digest"] as const) {
    const valor = um(params[chave]);
    if (valor) levar.set(chave, valor);
  }

  const busca = levar.toString();
  redirect(busca ? `/problemas?${busca}` : "/problemas");
}
