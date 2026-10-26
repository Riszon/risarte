import { Medal } from "lucide-react";
import { formatAnyDateBr } from "@/lib/dates";
import { explicacaoDoSelo, type SeloDeCertificacao } from "@/lib/conquistas";
import { cn } from "@/lib/utils";

/**
 * AS MEDALHAS DE CERTIFICAÇÃO (OC-00133). Uma por função certificada.
 *
 * Dourada = a pessoa tem aquela função hoje. Mais clara = já foi certificada
 * nela e mudou de função — continua à vista de propósito (decisão M4 do dono):
 * é o que serve para remanejar alguém ou cobrir um colega que faltou.
 *
 * Quem decide o que vira medalha é `src/lib/conquistas.ts`; aqui só se desenha.
 */
export function MedalhasDeCertificacao({
  selos,
  className,
}: {
  selos: SeloDeCertificacao[];
  className?: string;
}) {
  if (selos.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {selos.map((s) => (
        <span
          key={s.role}
          title={explicacaoDoSelo(s)}
          aria-label={explicacaoDoSelo(s)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            s.atual
              ? "border-gold/50 bg-gold/10 text-gold-tinta dark:text-gold"
              : "border-dashed border-border bg-transparent text-muted-foreground"
          )}
        >
          <Medal className="size-3" aria-hidden />
          {s.rotulo}
          {s.vezes > 1 && <span className="opacity-70">×{s.vezes}</span>}
        </span>
      ))}
    </span>
  );
}

/** A seção da ficha do Risartano: as medalhas e o histórico de cada uma. */
export function CertificacoesDaPessoa({
  selos,
  lidas,
}: {
  selos: SeloDeCertificacao[];
  lidas: boolean;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Medal className="size-4 text-gold-tinta" />
        Certificações
      </h2>
      {!lidas ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          Não foi possível conferir agora as certificações desta pessoa.
          Recarregue em instantes.
        </p>
      ) : selos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ainda nenhuma certificação concluída. Ela aparece aqui quando a pessoa
          cumpre a missão de uma função.
        </p>
      ) : (
        <ul className="space-y-2">
          {selos.map((s) => (
            <li key={s.role} className="space-y-1 rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <MedalhasDeCertificacao selos={[s]} />
                {!s.atual && (
                  <span className="text-xs text-muted-foreground">
                    Não tem mais esta função
                  </span>
                )}
              </div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {s.historico.map((h) => (
                  <li key={h.em}>
                    {formatAnyDateBr(h.em)} ·{" "}
                    {h.tipo === "certificacao" ? "Certificação" : "Reciclagem"}
                    {h.aprovadoPeloAdmin ? " · aprovada pelo Admin" : " · automática"}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** O Início da própria pessoa: as conquistas dela (só aparece quando há). */
export function MinhasCertificacoes({ selos }: { selos: SeloDeCertificacao[] }) {
  if (selos.length === 0) return null;
  return (
    <section className="rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm shadow-sm">
      <h2 className="flex items-center gap-1.5 font-semibold">
        <Medal className="size-4 text-gold-tinta" />
        {selos.length === 1 ? "Sua certificação" : "Suas certificações"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Cada medalha é uma função em que você cumpriu a missão de certificação.
      </p>
      <MedalhasDeCertificacao selos={selos} className="mt-3" />
    </section>
  );
}
