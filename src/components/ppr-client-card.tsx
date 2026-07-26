import Link from "next/link";
import { ChevronRight, CreditCard, HeartPulse, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import type {
  PprClientBadge,
  PprPastMembership,
} from "@/lib/ppr/client-badge-loader";

const TONE: Record<PprStatus, string> = {
  aguardando_ativacao: "border-amber-300 bg-amber-50 text-amber-800",
  ativo: "border-emerald-300 bg-emerald-50 text-emerald-800",
  suspenso: "border-rose-300 bg-rose-50 text-rose-800",
  cancelado: "border-border bg-muted text-muted-foreground",
};

/** Selo curto do PPR+ para a linha de badges do prontuário. */
export function PprBadge({ badge }: { badge: PprClientBadge }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE[badge.status]
      )}
      title={`PPR+ ${badge.planName} — ${PPR_STATUS_LABELS[badge.status]}`}
    >
      <HeartPulse className="size-3" />
      PPR+ {badge.planName}
      {badge.status !== "ativo" && ` · ${PPR_STATUS_LABELS[badge.status]}`}
    </span>
  );
}

/**
 * Bloco do PPR+ no prontuário: situação do plano, se é titular ou dependente,
 * a família ligada (clicável) e o cartão do beneficiário.
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
    return (
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <HeartPulse className="size-4 text-muted-foreground" />
            Programa de Prevenção Riso+
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {past.map((p, i) => (
              <li key={i}>
                Fez parte do <strong>{p.planName}</strong>
                {p.cancelledAt &&
                  ` até ${new Date(p.cancelledAt).toLocaleDateString("pt-BR")}`}
                {p.reason && ` — ${p.reason}`}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const isHolder = badge.role === "titular";

  return (
    <Card className="overflow-hidden">
      <span className="block h-1 bg-gold" aria-hidden />
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <HeartPulse className="size-4 text-gold-foreground" />
            PPR+ · {badge.planName}
          </CardTitle>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              TONE[badge.status]
            )}
          >
            {PPR_STATUS_LABELS[badge.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {isHolder ? "Titular do plano" : `Dependente${badge.relationship ? ` · ${badge.relationship}` : ""}`}
          {badge.activatedAt &&
            ` · ativo desde ${new Date(badge.activatedAt).toLocaleDateString("pt-BR")}`}
          {isHolder && ` · ${formatBRL(badge.monthlyCents)}/mês`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {badge.status === "suspenso" && (
          <p className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
            Plano <strong>suspenso</strong> — os benefícios não podem ser usados
            até a regularização das mensalidades.
          </p>
        )}
        {badge.status === "aguardando_ativacao" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Aguardando <strong>contrato assinado</strong> e{" "}
            <strong>primeira mensalidade</strong> para liberar os benefícios.
          </p>
        )}

        {/* Família ------------------------------------------------------- */}
        {!isHolder && badge.holder && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users className="size-3" />
              Titular do plano
            </p>
            <MemberLink
              href={`/prontuarios/${badge.holder.clientId}`}
              name={badge.holder.name}
              code={badge.holder.code}
              tag="titular"
            />
          </div>
        )}

        {isHolder && badge.dependents.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users className="size-3" />
              Dependentes ({badge.dependents.length})
            </p>
            <ul className="space-y-1.5">
              {badge.dependents.map((d) => (
                <li key={d.beneficiaryId}>
                  <MemberLink
                    href={`/prontuarios/${d.clientId}`}
                    name={d.name}
                    code={d.code}
                    tag={d.relationship ?? "dependente"}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/ppr/cartao/${badge.beneficiaryId}`} target="_blank" />}
          >
            <CreditCard className="mr-1 size-3.5" />
            Cartão do beneficiário
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/ppr/adesoes/${badge.membershipId}`} />}
          >
            Ver adesão
          </Button>
          {badge.cardCode && (
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {badge.cardCode}
            </span>
          )}
        </div>

        {past.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Histórico:{" "}
            {past
              .map(
                (p) =>
                  `${p.planName}${p.cancelledAt ? ` (até ${new Date(p.cancelledAt).toLocaleDateString("pt-BR")})` : ""}`
              )
              .join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MemberLink({
  href,
  name,
  code,
  tag,
}: {
  href: string;
  name: string;
  code: string | null;
  tag: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {code && <span className="font-mono">{code}</span>}
          <span className="rounded-full border px-1.5 py-0.5 uppercase">
            {tag}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
