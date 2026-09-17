import {
  ACESSO_EXPLICACAO,
  ACESSO_ROTULO,
  type SituacaoDeAcesso,
} from "@/lib/risartanos";
import { cn } from "@/lib/utils";

/**
 * A COR DIZ O QUE FAZER, não só o que é: vermelho e âmbar são as duas situações
 * que pedem alguém — login de quem saiu, e login sem cadastro. O resto é
 * informação, e informação não grita.
 */
const CORES: Record<SituacaoDeAcesso, string> = {
  com_acesso:
    "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  sem_acesso: "border-border bg-muted text-muted-foreground",
  acesso_desativado: "border-border bg-transparent text-muted-foreground",
  login_orfao: "border-destructive/30 bg-destructive/10 text-destructive",
  cadastro_incompleto:
    "border-gold/40 bg-gold/10 text-gold-tinta dark:text-gold",
};

export function SeloDeAcesso({
  situacao,
  className,
}: {
  situacao: SituacaoDeAcesso;
  className?: string;
}) {
  return (
    <span
      title={ACESSO_EXPLICACAO[situacao]}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        CORES[situacao],
        className
      )}
    >
      {ACESSO_ROTULO[situacao]}
    </span>
  );
}

/** Selo de unidade + função, com a marca de quem está inativo ali. */
export function SeloDeUnidade({
  nome,
  funcao,
  inativo,
  gerida,
}: {
  nome: string;
  funcao: string;
  inativo: boolean;
  gerida: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
        inativo
          ? "border-dashed border-border text-muted-foreground line-through decoration-1"
          : gerida
            ? "border-border bg-card"
            : "border-border/60 bg-transparent text-muted-foreground"
      )}
      title={inativo ? `Inativo em ${nome}` : `${funcao} em ${nome}`}
    >
      <span className="font-medium">{nome}</span>
      <span className="opacity-70">·</span>
      <span>{funcao}</span>
    </span>
  );
}
