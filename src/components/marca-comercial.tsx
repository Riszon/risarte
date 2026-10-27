import { Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A MARCA DA APRESENTAÇÃO COMERCIAL (OC-00135/OC-00136, 27/10/2026).
 *
 * A apresentação comercial fica na MESMA agenda e no MESMO Atendimento da
 * unidade — regra da rede: é a recepção que confirma, dá a chegada e
 * acompanha de perto. Faltava distinguir de relance: o cartão do comercial
 * era igual ao da clínica, só com o tipo escrito em cinza, e a recepção
 * confirmava ou dava chegada no paciente errado.
 *
 * Uma marca só, em toda tela: contorno fúcsia, ícone de apresentação e o tipo
 * escrito em fúcsia. A COR DE FUNDO continua sendo a da situação (agendado,
 * confirmado…) ou da etapa do Atendimento — é ela que diz o que fazer.
 *
 * Fúcsia porque é a matiz livre nas duas telas: azul-céu, verde, cinza,
 * vermelho e laranja são as situações da agenda; azul-céu, âmbar, violeta e
 * verde, as etapas do Atendimento; âmbar e vermelho, o encaixe.
 */
export function ehComercial(type: string): boolean {
  return type === "commercial_presentation";
}

/** Contorno do cartão — por dentro da borda, para não invadir o vizinho na grade. */
export const CONTORNO_COMERCIAL =
  "ring-2 ring-inset ring-fuchsia-500 dark:ring-fuchsia-400";

/** O tipo escrito em fúcsia, legível no claro e no escuro. */
export const TEXTO_COMERCIAL = "text-fuchsia-700 dark:text-fuchsia-300";

export function IconeComercial({ className }: { className?: string }) {
  return (
    <Presentation
      aria-hidden
      className={cn("size-3 shrink-0", TEXTO_COMERCIAL, className)}
    />
  );
}

/** Selo "Comercial" ao lado do nome (Atendimento e agenda da rede). */
export function SeloComercial({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-fuchsia-300 bg-fuchsia-50 px-1.5 py-px text-[10px] font-medium dark:border-fuchsia-400/40 dark:bg-fuchsia-500/15",
        TEXTO_COMERCIAL,
        className
      )}
    >
      <IconeComercial />
      Comercial
    </span>
  );
}
