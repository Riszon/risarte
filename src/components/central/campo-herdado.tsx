import { ORIGEM_DO_VALOR, type OrigemDoValor } from "@/lib/central/heranca";
import { cn } from "@/lib/utils";

/**
 * O SELO DE HERANÇA de um campo da Central no nível Unidade: "herdado da
 * rede" ou "personalizado", com o lugar do botão de voltar ao padrão.
 *
 * Um componente só, para toda aba mostrar a herança do mesmo jeito (antes
 * cada tela de configuração fazia a sua). A regra de qual valor vale mora em
 * `valorEfetivo` (`src/lib/central/central.ts`); aqui é só o desenho.
 *
 * A aba Conta e tarifas (ASA0) não tem campo herdado — a conta é sempre da
 * unidade. As abas Financeiro e Comercial (ASA1) são as primeiras a usar.
 */
export function CampoHerdado({
  rotulo,
  origem,
  valorDaRede,
  children,
  voltarAoPadrao,
}: {
  rotulo: string;
  origem: OrigemDoValor;
  /** O valor da rede já formatado, para a pessoa ver o que herdaria. */
  valorDaRede?: string | null;
  /** O campo (input) em si. */
  children: React.ReactNode;
  /** O botão "Voltar ao padrão da rede" — só faz sentido quando é personalizado. */
  voltarAoPadrao?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{rotulo}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            origem === "personalizado"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
              : "bg-muted text-muted-foreground"
          )}
        >
          {ORIGEM_DO_VALOR[origem]}
        </span>
        {origem === "personalizado" && voltarAoPadrao}
      </div>
      {children}
      {origem === "personalizado" && valorDaRede ? (
        <p className="text-xs text-muted-foreground">Padrão da rede: {valorDaRede}</p>
      ) : null}
    </div>
  );
}
