/**
 * OC-00154: "a última coisa que se faz é a confirmação da sequência, e para
 * entrar nessa aba precisa subir TODA a página". O botão no fim da página
 * chama a janela "Atendimentos e sequência" por este evento; quem tem a janela
 * na tela (o cockpit de planejamento) responde marcando `atendido`. Sem ninguém
 * para atender (na ficha do cliente), o botão leva ao cockpit, que abre a
 * janela pelo endereço (`?abrir=sequencia`).
 */
export const EVENTO_ABRIR_SEQUENCIA = "risarte:abrir-sequencia";

export type PedidoDeAbrir = { atendido: boolean };

/** Dispara o pedido; devolve se alguém na tela abriu a janela. */
export function pedirAbrirSequencia(): boolean {
  if (typeof window === "undefined") return false;
  const pedido: PedidoDeAbrir = { atendido: false };
  window.dispatchEvent(new CustomEvent<PedidoDeAbrir>(EVENTO_ABRIR_SEQUENCIA, { detail: pedido }));
  return pedido.atendido;
}
