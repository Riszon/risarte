import { Users } from "lucide-react";
import { ROLE_LABELS } from "@/lib/roles";
import { formatBrDateTime } from "@/lib/dates";
import {
  ROTULO_DA_SITUACAO,
  situacaoDaMatricula,
  type ColegaDoGrupo,
  type GrupoDaUnidade,
  type Situacao,
} from "@/lib/certificacao-equipe";
import { cn } from "@/lib/utils";

const TOM: Record<Situacao, string> = {
  certificado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  aguardando_aprovacao: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  cumpriu: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  em_andamento: "border-primary/40 bg-primary/10 text-primary",
  nao_aceitou: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  dispensado: "border-border bg-muted text-muted-foreground",
};

/**
 * A EQUIPE DA UNIDADE NA CERTIFICAÇÃO COLETIVA (0303, relato OC-00003).
 *
 * Na coletiva a unidade só abre quando o GRUPO inteiro cumpre — então quem já
 * fez a parte dele precisa saber por quem está esperando, e quem está
 * atrasado precisa saber que os outros dependem dele. O grupo é o mesmo que
 * segura a unidade no banco (`my_training_group` espelha `_system_access_raw`).
 *
 * O progresso dos colegas é a ÚLTIMA MEDIÇÃO guardada, e a data dela aparece:
 * um número sem data pareceria tirado agora.
 */
export function EquipeDaCertificacao({
  grupos,
}: {
  grupos: GrupoDaUnidade<ColegaDoGrupo>[];
}) {
  if (grupos.length === 0) return null;
  return (
    <div className="space-y-3">
      {grupos.map((g) => (
        <div key={g.clinicId} className="rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h2 className="font-semibold">Sua equipe na certificação — {g.clinicName}</h2>
                <p className="text-sm text-muted-foreground">
                  A unidade abre no sistema real quando <strong>todos</strong> cumprirem a
                  missão. <strong>{g.cumpriram} de {g.total}</strong> já cumpriram.
                </p>
              </div>
              <ul className="divide-y rounded-lg border">
                {g.pessoas.map((p) => {
                  const s = situacaoDaMatricula(p);
                  return (
                    <li key={`${p.userId}:${p.role}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {p.nome}
                          {p.souEu && " (você)"}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {ROLE_LABELS[p.role] ?? p.role}
                        </span>
                      </span>
                      {s === "em_andamento" && (
                        <span className="text-xs text-muted-foreground">
                          {p.percentual === null || !p.medidoEm
                            ? "ainda não medido"
                            : `${p.percentual}% · medido em ${formatBrDateTime(p.medidoEm)}`}
                        </span>
                      )}
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TOM[s])}>
                        {ROTULO_DA_SITUACAO[s]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
