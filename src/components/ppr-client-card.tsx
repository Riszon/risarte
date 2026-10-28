import Link from "next/link";
import { CreditCard, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import type {
  PprClientBadge,
  PprPastMembership,
} from "@/lib/ppr/client-badge-loader";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import type { Tom } from "@/lib/tons";
import { MiniCartao } from "@/components/prontuario/mini-cartao";
import { PessoaChip } from "@/components/prontuario/pessoa-chip";

const TOM_PPR: Record<PprStatus, Tom> = {
  aguardando_ativacao: "ambar",
  ativo: "verde",
  suspenso: "vermelho",
  cancelado: "neutro",
};

/** O que a situação implica — sem repetir o nome dela (o selo já diz). */
const EXPLICACAO: Partial<Record<PprStatus, string>> = {
  aguardando_ativacao:
    "Os benefícios liberam com o contrato assinado e a primeira mensalidade paga.",
  suspenso: "Os benefícios ficam parados até as mensalidades serem regularizadas.",
};

function dataBr(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE });
}

/**
 * O PPR+ no prontuário, como mini-cartão da faixa "Programas e tratamentos"
 * (28/10/2026): a situação dita uma vez, a família como fichas clicáveis, o
 * cartão do beneficiário e a adesão. Sem adesão atual e sem passado, nada.
 */
export function PprClientCard({
  badge,
  past,
}: {
  badge: PprClientBadge | null;
  past: PprPastMembership[];
}) {
  if (!badge) {
    if (past.length === 0) return null;
    const p = past[0];
    return (
      <MiniCartao
        icone={HeartPulse}
        titulo="PPR+ · Riso+"
        situacao={{ rotulo: "Encerrado", tom: "neutro" }}
        linha={
          <>
            Fez parte do <strong>{p.planName}</strong>
            {p.cancelledAt && ` até ${dataBr(p.cancelledAt)}`}
            {p.reason && ` — ${p.reason}`}
            {past.length > 1 && ` · e mais ${past.length - 1}`}
          </>
        }
      />
    );
  }

  const isHolder = badge.role === "titular";
  const explicacao = EXPLICACAO[badge.status];

  return (
    <MiniCartao
      icone={HeartPulse}
      titulo={`PPR+ · ${badge.planName}`}
      situacao={{ rotulo: PPR_STATUS_LABELS[badge.status], tom: TOM_PPR[badge.status] }}
      linha={
        <>
          {isHolder
            ? "Titular"
            : `Dependente${badge.relationship ? ` · ${badge.relationship}` : ""}`}
          {isHolder && ` · ${formatBRL(badge.monthlyCents)}/mês`}
          {badge.activatedAt && ` · desde ${dataBr(badge.activatedAt)}`}
          {badge.cardCode && (
            <>
              {" · "}
              <span className="font-mono">{badge.cardCode}</span>
            </>
          )}
        </>
      }
      acoes={
        <>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/ppr/cartao/${badge.beneficiaryId}`} target="_blank" />}
          >
            <CreditCard className="mr-1 size-3.5" />
            Cartão
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/ppr/adesoes/${badge.membershipId}`} />}
          >
            Ver adesão
          </Button>
        </>
      }
    >
      {explicacao && <p className="text-xs text-muted-foreground">{explicacao}</p>}

      {!isHolder && badge.holder && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Titular:</span>
          <PessoaChip
            href={`/prontuarios/${badge.holder.clientId}`}
            nome={badge.holder.name}
            codigo={badge.holder.code}
          />
        </div>
      )}

      {isHolder && badge.dependents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            {badge.dependents.length === 1
              ? "Dependente:"
              : `${badge.dependents.length} dependentes:`}
          </span>
          {badge.dependents.map((d) => (
            <PessoaChip
              key={d.beneficiaryId}
              href={`/prontuarios/${d.clientId}`}
              nome={d.name}
              codigo={d.code}
              etiqueta={d.relationship}
            />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Antes:{" "}
          {past
            .map((p) => `${p.planName}${p.cancelledAt ? ` (até ${dataBr(p.cancelledAt)})` : ""}`)
            .join(" · ")}
        </p>
      )}
    </MiniCartao>
  );
}
