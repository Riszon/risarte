import { CheckCircle2, CircleAlert } from "lucide-react";
import type { Medicao } from "@/lib/certificacao";

/**
 * O PROGRESSO DA MISSÃO — o mesmo desenho no cartão da pessoa e na lista do
 * Admin. Um componente só, de propósito: se cada tela desenhasse o seu, os
 * dois poderiam discordar sobre o que é "cumprido", e a pessoa veria uma coisa
 * enquanto o Admin decide olhando outra.
 *
 * ⚠️ "NÃO DEU PARA MEDIR" TEM COR E FRASE PRÓPRIAS, nunca uma barra vazia. Uma
 * barra em zero diria à pessoa que o trabalho dela sumiu; a verdade é que ele
 * está no treino e a medição é que falhou.
 */
export function ProgressoDaMissao({
  medicao,
  compacto = false,
}: {
  medicao: Medicao;
  compacto?: boolean;
}) {
  if (medicao.estado === "nao_comecou") {
    return (
      <p className="text-xs text-muted-foreground">
        Ainda não começou — nada está sendo contado.
      </p>
    );
  }

  if (medicao.estado === "sem_medicao") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Não foi possível medir agora: {medicao.motivo}.
          {!compacto &&
            " O trabalho feito não se perde — ele está no treino e aparece aqui quando a medição voltar."}
        </span>
      </p>
    );
  }

  const { itens, cumprida, semMedida, percentual } = medicao.progresso;

  if (compacto) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5">
          {itens.map((i) => (
            <span
              key={i.chave}
              title={i.motivo ?? i.rotulo}
              className={
                i.feito === null
                  ? "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                  : i.cumprido
                    ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              }
            >
              {i.rotulo}: {i.feito === null ? "?" : Math.min(i.feito, i.minimo)}/
              {i.minimo}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {cumprida
            ? "✓ Missão cumprida"
            : semMedida > 0
              ? `${percentual}% do que foi medido · ${semMedida} critério(s) sem medida`
              : `${percentual}% concluído`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cumprida ? (
        <p className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm font-medium text-primary">
          <CheckCircle2 className="size-4 shrink-0" />
          Missão cumprida! A liberação do sistema real é o próximo passo.
        </p>
      ) : (
        <p className="text-sm font-medium">{percentual}% concluído</p>
      )}

      <ul className="space-y-2.5">
        {itens.map((i) => {
          // A barra nunca passa de cheia: fazer 20 de 5 é "cumprido", não
          // "400%" — e a sobra não compensa outro critério.
          const parte =
            i.feito === null ? 0 : Math.min(100, Math.round((i.feito / i.minimo) * 100));
          return (
            <li key={i.chave} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{i.rotulo}</span>
                <span
                  className={
                    i.feito === null
                      ? "shrink-0 text-xs text-amber-700 dark:text-amber-400"
                      : "shrink-0 tabular-nums text-muted-foreground"
                  }
                >
                  {i.feito === null
                    ? "não deu para medir"
                    : `${Math.min(i.feito, i.minimo)} de ${i.minimo}`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={i.cumprido ? "h-full bg-primary" : "h-full bg-primary/50"}
                  style={{ width: `${parte}%` }}
                />
              </div>
              {i.motivo && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{i.motivo}</p>
              )}
            </li>
          );
        })}
      </ul>

      {semMedida > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {semMedida} critério(s) não puderam ser medidos agora. A missão só é
          dada por cumprida quando TUDO pode ser conferido — nada é liberado no
          escuro.
        </p>
      )}
    </div>
  );
}
