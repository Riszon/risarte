/**
 * POR QUAL UNIDADE A ASSINATURA DO PACIENTE SAI (AP158, item 1). O banco só
 * aceita a unidade de cadastro do paciente ou a preferida
 * (`signature_create_package`). A unidade ativa vale quando é uma delas; se for
 * só uma unidade com quem o paciente está compartilhado (agenda, E7), a
 * assinatura sai pela preferida, senão pela de cadastro. Regra pura.
 */
export function unidadeDoEnvio(input: { ativa: string | null; cadastro: string; preferida: string | null }): string {
  if (input.ativa && (input.ativa === input.cadastro || input.ativa === input.preferida)) return input.ativa;
  return input.preferida ?? input.cadastro;
}
