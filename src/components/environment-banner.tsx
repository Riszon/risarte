import { isTreino } from "@/lib/environment";

/**
 * A faixa que diz, o tempo todo, que aquele NÃO é o sistema de verdade.
 *
 * Fica no topo de TODAS as telas — inclusive do login, que é onde a confusão
 * começa, e dos documentos impressos, para ninguém arquivar um termo de teste
 * como se fosse assinado de verdade.
 *
 * Some por completo na produção: `isTreino()` devolve falso quando a variável
 * não existe, então o sistema real nunca mostra faixa nenhuma.
 *
 * Listrada e amarela por decisão, não por enfeite: precisa ser reconhecível
 * pelo canto do olho, sem ler. Quem trabalha nas duas telas o dia inteiro para
 * de ler avisos na primeira semana.
 */
export function EnvironmentBanner() {
  if (!isTreino()) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-widest text-amber-950"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, #f5c542 0 12px, #e3ae2a 12px 24px)",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>
        Ambiente de treino — os dados aqui não são reais e podem ser apagados
      </span>
      <span aria-hidden="true">⚠</span>
    </div>
  );
}
