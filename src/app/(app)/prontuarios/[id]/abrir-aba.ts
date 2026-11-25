/** OC-00184: pedir à barra de abas do prontuário que troque de aba e role até uma seção. */
export const EVENTO_ABRIR_ABA = "risarte:prontuario-abrir-aba";
export type PedidoDeAba = { aba: string; secao?: string; atendido: boolean };
