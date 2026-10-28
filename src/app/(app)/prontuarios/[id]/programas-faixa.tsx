import { Building2 } from "lucide-react";
import { PprClientCard } from "@/components/ppr-client-card";
import { OrthoClientCard } from "@/components/ortodontia/ortho-client-card";
import { MiniCartao } from "@/components/prontuario/mini-cartao";
import { PessoaChip } from "@/components/prontuario/pessoa-chip";
import {
  RELATIONSHIP_LABELS,
  type Relationship,
} from "@/lib/empresarial/constants";
import type { PprClientBadge, PprPastMembership } from "@/lib/ppr/client-badge-loader";
import type { OrthoClientBadge } from "@/lib/ortodontia/client-badge-loader";

export type EmpresarialNaFicha = {
  companyName: string | null;
  active: boolean;
  family: {
    client_id: string | null;
    full_name: string;
    role: string;
    relationship: string | null;
    active: boolean;
  }[];
};

/**
 * A FAIXA "PROGRAMAS E TRATAMENTOS" DO PRONTUÁRIO (28/10/2026).
 *
 * PPR+, Ortodontia e Empresarial lado a lado, em mini-cartões, logo abaixo
 * do cabeçalho. Antes eram três cartões grandes empilhados antes das abas,
 * cada um dizendo a própria situação em dois ou três lugares. Sem nenhum
 * programa, a faixa não existe.
 */
export function ProgramasFaixa({
  ppr,
  pprPassado,
  ortho,
  empresarial,
}: {
  ppr: PprClientBadge | null;
  pprPassado: PprPastMembership[];
  ortho: OrthoClientBadge | null;
  empresarial: EmpresarialNaFicha | null;
}) {
  const temPpr = Boolean(ppr) || pprPassado.length > 0;
  const quantos = [temPpr, Boolean(ortho), Boolean(empresarial)].filter(Boolean).length;
  if (quantos === 0) return null;

  return (
    <div
      className={
        quantos === 1
          ? "grid gap-3"
          : quantos === 2
            ? "grid gap-3 md:grid-cols-2"
            : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      }
    >
      {temPpr && <PprClientCard badge={ppr} past={pprPassado} />}
      <OrthoClientCard badge={ortho} />
      {empresarial && <EmpresarialMiniCartao dados={empresarial} />}
    </div>
  );
}

function EmpresarialMiniCartao({ dados }: { dados: EmpresarialNaFicha }) {
  return (
    <MiniCartao
      icone={Building2}
      titulo={`Empresarial${dados.companyName ? ` · ${dados.companyName}` : ""}`}
      situacao={
        dados.active
          ? { rotulo: "Vínculo ativo", tom: "verde" }
          : { rotulo: "Vínculo encerrado", tom: "neutro" }
      }
      linha="Benefícios do programa da empresa entram no orçamento, procedimento a procedimento."
    >
      {dados.family.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {dados.family.map((f, i) => (
            <PessoaChip
              key={`${f.client_id ?? "sem"}-${i}`}
              href={f.client_id ? `/prontuarios/${f.client_id}` : null}
              nome={f.full_name}
              etiqueta={
                f.role === "titular"
                  ? "titular"
                  : (RELATIONSHIP_LABELS[f.relationship as Relationship] ?? "dependente")
              }
              apagado={!f.active || !f.client_id}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sem dependentes cadastrados no programa.</p>
      )}
    </MiniCartao>
  );
}
