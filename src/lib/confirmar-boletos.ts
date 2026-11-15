// ASA4, 1B (4015; spec 19.27 ponto 3): a CONFIRMAÇÃO antes de uma operação que
// cancela boletos já entregues ao cliente. A operação devolve `precisaConfirmar`
// com o texto ("esta operação cancela N boletos já entregues ao cliente"); a tela
// pergunta e, confirmada, repete a operação com a confirmação. Recusada, nada muda.

type ComConfirmacao = { ok: boolean; error?: string; precisaConfirmar?: number };

export async function comConfirmacaoDeBoletos<R extends ComConfirmacao>(
  fazer: (confirmar: boolean) => Promise<R>,
  perguntar: (texto: string) => boolean = (t) => (typeof window !== "undefined" ? window.confirm(t) : false)
): Promise<R> {
  const r = await fazer(false);
  if (r.ok || !r.precisaConfirmar) return r;
  if (!perguntar(r.error ?? `Esta operação cancela ${r.precisaConfirmar} boleto(s) já entregue(s) ao cliente. Confirmar?`)) {
    return { ...r, error: "Operação não feita: os boletos continuam valendo." };
  }
  return fazer(true);
}
