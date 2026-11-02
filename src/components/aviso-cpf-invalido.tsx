import { AlertTriangle } from "lucide-react";
import { AVISO_CPF_INVALIDO, cpfDigitadoInvalido } from "@/lib/cpf-invalido";

/** Aviso âmbar abaixo do campo de CPF; some quando o CPF confere (AP90). */
export function AvisoCpfInvalido({ cpf }: { cpf: string | null | undefined }) {
  if (!cpfDigitadoInvalido(cpf)) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {AVISO_CPF_INVALIDO}
    </p>
  );
}
