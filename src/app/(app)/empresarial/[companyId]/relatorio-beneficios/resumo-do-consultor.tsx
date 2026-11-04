import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj } from "@/lib/masks";
import { formatAnyDateBr } from "@/lib/dates";
import {
  EMPLOYEE_STATUS_LABELS,
  RELATIONSHIP_LABELS,
  type EmployeeStatus,
  type Relationship,
} from "@/lib/empresarial/constants";
import { TopoDoRelatorio } from "../../topo-do-relatorio";

/**
 * O USO DO PROGRAMA, PARA O CONSULTOR RISLIFE (AP95, decisão do dono,
 * 03/11/2026). Ele acompanha se os beneficiários das empresas dele usam o
 * programa — sem dado clínico: nada de sessões, pilares, evolução ou CPF. A
 * conta é do banco (`empresarial.consultant_usage_summary`, 1039), que só
 * responde ao gestor e ao consultor responsável pela empresa.
 */

export type ResumoDoUso = {
  membros: {
    nome: string;
    papel: "HOLDER" | "DEPENDENT";
    parentesco: Relationship | null;
    titular: string | null;
    situacao: EmployeeStatus;
    unidade: string | null;
    usos: number;
    cheio_cents: number;
    pago_cents: number;
    economia_cents: number;
    atendimentos: number;
    agendados: number;
    faltas: number;
    cancelados: number;
    ultimo_atendimento: string | null;
  }[];
  usos: {
    data: string;
    nome: string;
    procedimento: string | null;
    unidade: string | null;
    cheio_cents: number;
    pago_cents: number;
    economia_cents: number;
  }[];
};

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

export function ResumoDoConsultor({
  empresa,
  resumo,
}: {
  empresa: { legalName: string; tradeName: string | null; cnpj: string };
  resumo: ResumoDoUso;
}) {
  const m = resumo.membros;
  const soma = (f: (x: ResumoDoUso["membros"][number]) => number) => m.reduce((a, x) => a + f(x), 0);
  const usando = m.filter((x) => x.usos > 0 || x.atendimentos > 0).length;

  return (
    <div className="space-y-6">
      <TopoDoRelatorio tipo="uso do programa">
        <div>
          <h1 className="text-xl font-semibold">{empresa.tradeName || empresa.legalName}</h1>
          <p className="text-sm text-muted-foreground">
            {empresa.legalName} · CNPJ {formatCnpj(empresa.cnpj)}
          </p>
        </div>
      </TopoDoRelatorio>

      <p className="text-sm text-muted-foreground">
        Quem já virou cliente nas unidades e como está usando o programa. Sem dado clínico: o
        acompanhamento do tratamento é da unidade.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Beneficiários nas unidades" value={String(m.length)} />
        <Kpi label="Usando o programa" value={`${usando} de ${m.length}`} />
        <Kpi label="Atendimentos concluídos" value={String(soma((x) => x.atendimentos))} />
        <Kpi label="Economia gerada" value={formatBRL(soma((x) => x.economia_cents))} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por beneficiário</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {m.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ninguém desta empresa virou cliente numa unidade ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Beneficiário</th>
                  <th className="py-1.5 pr-3 font-medium">Unidade</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Atendimentos</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Agendados</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Faltas</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Cancelados</th>
                  <th className="py-1.5 pr-3 font-medium">Último atendimento</th>
                  <th className="py-1.5 text-right font-medium">Economia</th>
                </tr>
              </thead>
              <tbody>
                {m.map((x, i) => (
                  <tr key={`${x.nome}-${i}`} className="border-t">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium">{x.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {x.papel === "HOLDER"
                          ? "Titular"
                          : `${x.parentesco ? RELATIONSHIP_LABELS[x.parentesco] ?? "Dependente" : "Dependente"} de ${x.titular ?? "—"}`}
                        {x.situacao !== "ACTIVE" && (
                          <Badge variant="outline" className="ml-2">
                            {EMPLOYEE_STATUS_LABELS[x.situacao] ?? x.situacao}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3">{x.unidade ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.atendimentos}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.agendados}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.faltas}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.cancelados}</td>
                    <td className="py-1.5 pr-3">{x.ultimo_atendimento ? formatAnyDateBr(x.ultimo_atendimento) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatBRL(x.economia_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usos do benefício</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {resumo.usos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum uso do benefício registrado ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Data</th>
                  <th className="py-1.5 pr-3 font-medium">Beneficiário</th>
                  <th className="py-1.5 pr-3 font-medium">Procedimento</th>
                  <th className="py-1.5 pr-3 font-medium">Unidade</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Valor cheio</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Pago</th>
                  <th className="py-1.5 text-right font-medium">Economia</th>
                </tr>
              </thead>
              <tbody>
                {resumo.usos.map((u, i) => (
                  <tr key={`${u.data}-${i}`} className="border-t">
                    <td className="py-1.5 pr-3">{formatAnyDateBr(u.data)}</td>
                    <td className="py-1.5 pr-3">{u.nome}</td>
                    <td className="py-1.5 pr-3">{u.procedimento ?? "—"}</td>
                    <td className="py-1.5 pr-3">{u.unidade ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(u.cheio_cents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(u.pago_cents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatBRL(u.economia_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
