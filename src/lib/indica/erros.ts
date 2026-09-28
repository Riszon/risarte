/**
 * Mensagens do banco do Indica +Risos → texto para a tela.
 *
 * Toda recusa do motor vem como `INDICA_<CÓDIGO>: <frase em português>`, e a
 * frase já foi escrita para quem opera ("esta pessoa já foi indicada
 * (IND-000012). Vale o primeiro registro."). Aqui só se tira o código da
 * frente — traduzir de novo criaria duas versões da mesma regra.
 *
 * O que NÃO é do motor não vaza para a tela: erro técnico vira uma frase
 * genérica (e vai inteiro para o log do servidor, por quem chamou).
 */
export type ErroDoBanco = { message?: string; code?: string } | null | undefined;

const GENERICA = "Não foi possível concluir. Tente de novo.";

export function mensagemDoBanco(erro: ErroDoBanco): string {
  if (!erro) return GENERICA;
  const texto = String(erro.message ?? "");

  const doMotor = texto.match(/INDICA_[A-Z_]+:\s*([\s\S]+)$/);
  if (doMotor) {
    const frase = doMotor[1].trim();
    return frase.charAt(0).toUpperCase() + frase.slice(1);
  }

  // Schema ou função que o banco ainda não tem: migração não aplicada, ou o
  // schema fora de "Exposed schemas". Dizer isso poupa um chamado.
  if (
    erro.code === "42883" ||
    erro.code === "PGRST202" ||
    erro.code === "PGRST106" ||
    erro.code === "42P01"
  ) {
    return "O Indica +Risos ainda não está instalado neste banco. Avise o administrador.";
  }
  if (erro.code === "42501" || /row-level security|permission denied/i.test(texto)) {
    return "Você não tem permissão para esta ação.";
  }
  return GENERICA;
}
