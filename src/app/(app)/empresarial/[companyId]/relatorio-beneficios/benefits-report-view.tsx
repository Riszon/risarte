"use client";

import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj, formatCpf } from "@/lib/masks";
import { PILLAR_LABELS, type MethodologyPillar } from "@/lib/journey";
import { RELATIONSHIP_LABELS } from "@/lib/empresarial/constants";
import type { BenefitsReport, MemberStats } from "./data";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #extrato-beneficios, #extrato-beneficios * { visibility: visible !important; }
  #extrato-beneficios { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .no-print { display: none !important; }
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
}
`;

function d(iso: string | null): string {
  if (!iso) return "—";
  const date = iso.length <= 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  return date.toLocaleDateString("pt-BR");
}

function pillarLabel(p: MethodologyPillar | "unset"): string {
  return p === "unset" ? "Sem pilar definido" : PILLAR_LABELS[p];
}

function memberRole(m: MemberStats): string {
  if (m.role === "HOLDER") return "Titular";
  const rel = m.relationship ? RELATIONSHIP_LABELS[m.relationship] : "Dependente";
  return `${rel}${m.holderName ? ` de ${m.holderName}` : ""}`;
}

function Kpi({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-semibold${gold ? " text-gold" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function BenefitsReportView({ report }: { report: BenefitsReport }) {
  const { company: c, totals: t, members, byPillar, byClinic } = report;
  const withUsage = members.filter((m) => m.usageCount > 0);

  async function exportExcel() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Aba 1 — Resumo
      const resumo = XLSX.utils.aoa_to_sheet([
        ["EXTRATO DE BENEFÍCIOS — RISARTE EMPRESARIAL"],
        ["Empresa", c.tradeName || c.legalName],
        ["CNPJ", formatCnpj(c.cnpj)],
        ["Gerado em", d(report.generatedAt)],
        [],
        ["Valor cheio dos procedimentos (R$)", (t.fullCents / 100).toFixed(2)],
        ["Valor pago pelos beneficiários (R$)", (t.chargedCents / 100).toFixed(2)],
        ["Economia gerada (R$)", (t.savedCents / 100).toFixed(2)],
        ["Benefícios utilizados", t.usageCount],
        ["Beneficiários que usaram", t.membersWithUsage],
        [],
        ["Sessões realizadas", t.sessionsDone],
        ["Sessões em aberto", t.sessionsOpen],
        ["Procedimentos concluídos", t.proceduresDone],
        ["Procedimentos em aberto", t.proceduresOpen],
        ["Atendimentos realizados", t.attendancesDone],
        ["Agendamentos futuros", t.futureAppointments],
        ["Faltas", t.noShows],
        ["Cancelamentos", t.cancellations],
        ["Atrasos (check-in após o horário)", t.lateArrivals],
        [],
        ["PILAR DA METODOLOGIA", "Sessões", "%"],
        ...byPillar.map((p) => [pillarLabel(p.pillar), p.count, `${p.percent}%`]),
        [],
        ["UNIDADE", "Vinculados", "Atendidos", "Sessões feitas", "Economia (R$)"],
        ...byClinic.map((u) => [
          u.clinicName,
          u.linkedMembers,
          u.attendedMembers,
          u.sessionsDone,
          (u.savedCents / 100).toFixed(2),
        ]),
      ]);
      resumo["!cols"] = [{ wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, resumo, "Resumo");

      // Aba 2 — Por beneficiário
      const porPessoa = XLSX.utils.aoa_to_sheet([
        [
          "Nome", "CPF", "Vínculo", "Situação", "Unidade",
          "Valor cheio (R$)", "Pago (R$)", "Economia (R$)", "Benefícios usados",
          "Sessões feitas", "Sessões em aberto",
          "Proced. concluídos", "Proced. em aberto",
          "Atendimentos", "Agend. futuros", "Faltas", "Cancelamentos", "Atrasos",
        ],
        ...members.map((m) => [
          m.name,
          formatCpf(m.cpf),
          memberRole(m),
          m.status === "ACTIVE" ? "Ativo" : "Inativo",
          m.clinicName ?? "",
          (m.fullCents / 100).toFixed(2),
          (m.chargedCents / 100).toFixed(2),
          (m.savedCents / 100).toFixed(2),
          m.usageCount,
          m.sessionsDone,
          m.sessionsOpen,
          m.proceduresDone,
          m.proceduresOpen,
          m.attendancesDone,
          m.futureAppointments,
          m.noShows,
          m.cancellations,
          m.lateArrivals,
        ]),
      ]);
      porPessoa["!cols"] = [
        { wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 18 },
        { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
        { wch: 14 }, { wch: 16 }, { wch: 17 }, { wch: 16 },
        { wch: 13 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 9 },
      ];
      XLSX.utils.book_append_sheet(wb, porPessoa, "Por beneficiário");

      // Aba 3 — Extrato (uma linha por uso de benefício)
      const extrato = XLSX.utils.aoa_to_sheet([
        ["Beneficiário", "Vínculo", "Data", "Procedimento", "Valor cheio (R$)", "Pago (R$)", "Economia (R$)"],
        ...members.flatMap((m) =>
          m.usages.map((u) => [
            m.name,
            memberRole(m),
            d(u.usedAt),
            u.procedureName,
            (u.fullCents / 100).toFixed(2),
            (u.chargedCents / 100).toFixed(2),
            (u.savedCents / 100).toFixed(2),
          ])
        ),
      ]);
      extrato["!cols"] = [
        { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 30 },
        { wch: 15 }, { wch: 12 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, extrato, "Extrato");

      const safe = (c.tradeName || c.legalName)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase();
      XLSX.writeFile(wb, `beneficios-${safe}.xlsx`);
    } catch {
      toast.error("Não foi possível gerar a planilha.");
    }
  }

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Extrato de benefícios e economia
          </h1>
          <p className="text-sm text-muted-foreground">
            Por colaborador e dependente, com os indicadores de tratamento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download className="mr-1 size-4" />
            Excel
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 size-4" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <div id="extrato-beneficios" className="space-y-5">
        <header className="avoid-break border-b pb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Risarte Empresarial — extrato de benefícios e economia
          </p>
          <h2 className="mt-0.5 text-2xl font-semibold">
            {c.tradeName || c.legalName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatCnpj(c.cnpj)} · gerado em {d(report.generatedAt)}
          </p>
        </header>

        {members.length === 0 ? (
          <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
            Nenhum colaborador/dependente vinculado a um cliente ainda — complete
            os cadastros para o extrato começar a registrar uso e economia.
          </p>
        ) : (
          <>
            {/* Economia */}
            <section className="avoid-break">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Economia gerada pelo programa
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Kpi label="Valor cheio" value={formatBRL(t.fullCents)} />
                <Kpi label="Pago pelos beneficiários" value={formatBRL(t.chargedCents)} />
                <Kpi label="Economia total" value={formatBRL(t.savedCents)} gold />
                <Kpi label="Benefícios usados" value={String(t.usageCount)} />
                <Kpi
                  label="Beneficiários que usaram"
                  value={`${t.membersWithUsage} de ${members.length}`}
                />
              </div>
            </section>

            {/* Tratamento e agenda */}
            <section className="avoid-break">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Tratamento e atendimentos
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Kpi label="Sessões realizadas" value={String(t.sessionsDone)} />
                <Kpi label="Sessões em aberto" value={String(t.sessionsOpen)} />
                <Kpi label="Proced. concluídos" value={String(t.proceduresDone)} />
                <Kpi label="Proced. em aberto" value={String(t.proceduresOpen)} />
                <Kpi label="Atendimentos realizados" value={String(t.attendancesDone)} />
                <Kpi label="Agendamentos futuros" value={String(t.futureAppointments)} />
                <Kpi label="Faltas" value={String(t.noShows)} />
                <Kpi label="Cancelamentos" value={String(t.cancellations)} />
                <Kpi label="Atrasos" value={String(t.lateArrivals)} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Atraso = check-in registrado depois do horário marcado.
              </p>
            </section>

            {/* Pilar */}
            <section className="avoid-break">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Distribuição por pilar da metodologia
              </h3>
              {byPillar.length === 0 ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Sem sessões registradas ainda.
                </p>
              ) : (
                <div className="space-y-1.5 rounded-lg border p-3">
                  {byPillar.map((p) => (
                    <div key={p.pillar} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 text-sm">
                        {pillarLabel(p.pillar)}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
                        <span
                          className="block h-full rounded bg-gold"
                          style={{ width: `${Math.max(p.percent, 1)}%` }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {p.count} · {p.percent}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Unidades */}
            <section className="avoid-break">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Por unidade franqueada
              </h3>
              {byClinic.length === 0 ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Nenhuma unidade com vínculo ou atendimento ainda.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Unidade</th>
                        <th className="px-3 py-2 font-medium">Vinculados</th>
                        <th className="px-3 py-2 font-medium">Atendidos</th>
                        <th className="px-3 py-2 font-medium">Sessões feitas</th>
                        <th className="px-3 py-2 font-medium">Economia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byClinic.map((u) => (
                        <tr key={u.clinicId} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{u.clinicName}</td>
                          <td className="px-3 py-2">{u.linkedMembers}</td>
                          <td className="px-3 py-2">{u.attendedMembers}</td>
                          <td className="px-3 py-2">{u.sessionsDone}</td>
                          <td className="px-3 py-2 text-gold">
                            {formatBRL(u.savedCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Quadro geral por beneficiário */}
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Quadro por beneficiário ({members.length})
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/30 text-left uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 font-medium">Beneficiário</th>
                      <th className="px-2 py-2 font-medium">Vínculo</th>
                      <th className="px-2 py-2 font-medium">Unidade</th>
                      <th className="px-2 py-2 font-medium">Economia</th>
                      <th className="px-2 py-2 font-medium">Sessões<br />feitas/abertas</th>
                      <th className="px-2 py-2 font-medium">Proced.<br />concl./abertos</th>
                      <th className="px-2 py-2 font-medium">Atend.</th>
                      <th className="px-2 py-2 font-medium">Futuros</th>
                      <th className="px-2 py-2 font-medium">Faltas</th>
                      <th className="px-2 py-2 font-medium">Canc.</th>
                      <th className="px-2 py-2 font-medium">Atrasos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.clientId} className="border-b last:border-0">
                        <td className="px-2 py-1.5">
                          <span className="font-medium">{m.name}</span>
                          {m.status === "INACTIVE" && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              Inativo
                            </Badge>
                          )}
                          <span className="block text-[10px] text-muted-foreground">
                            {formatCpf(m.cpf)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {memberRole(m)}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {m.clinicName ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 font-medium text-gold">
                          {formatBRL(m.savedCents)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {m.sessionsDone} / {m.sessionsOpen}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {m.proceduresDone} / {m.proceduresOpen}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{m.attendancesDone}</td>
                        <td className="px-2 py-1.5 tabular-nums">{m.futureAppointments}</td>
                        <td className="px-2 py-1.5 tabular-nums">{m.noShows}</td>
                        <td className="px-2 py-1.5 tabular-nums">{m.cancellations}</td>
                        <td className="px-2 py-1.5 tabular-nums">{m.lateArrivals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Extrato detalhado por pessoa */}
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Extrato de economia por beneficiário
              </h3>
              {withUsage.length === 0 ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Nenhum benefício utilizado até agora. Os usos passam a aparecer
                  aqui quando as sessões são concluídas no atendimento.
                </p>
              ) : (
                <div className="space-y-2">
                  {withUsage.map((m) => (
                    <div key={m.clientId} className="avoid-break rounded-lg border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">
                          {m.name}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {memberRole(m)}
                            {m.clinicName ? ` · ${m.clinicName}` : ""}
                          </span>
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Economia: </span>
                          <span className="font-semibold text-gold">
                            {formatBRL(m.savedCents)}
                          </span>
                        </p>
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-2 font-medium">Data</th>
                              <th className="py-1 pr-2 font-medium">Procedimento</th>
                              <th className="py-1 pr-2 text-right font-medium">Valor cheio</th>
                              <th className="py-1 pr-2 text-right font-medium">Pagou</th>
                              <th className="py-1 text-right font-medium">Economizou</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.usages.map((u, i) => (
                              <tr key={i} className="border-t">
                                <td className="py-1 pr-2">{d(u.usedAt)}</td>
                                <td className="py-1 pr-2">{u.procedureName}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {formatBRL(u.fullCents)}
                                </td>
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {formatBRL(u.chargedCents)}
                                </td>
                                <td className="py-1 text-right font-medium tabular-nums text-gold">
                                  {formatBRL(u.savedCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t font-medium">
                              <td className="py-1 pr-2" colSpan={2}>
                                Total ({m.usageCount})
                              </td>
                              <td className="py-1 pr-2 text-right tabular-nums">
                                {formatBRL(m.fullCents)}
                              </td>
                              <td className="py-1 pr-2 text-right tabular-nums">
                                {formatBRL(m.chargedCents)}
                              </td>
                              <td className="py-1 text-right tabular-nums text-gold">
                                {formatBRL(m.savedCents)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <footer className="avoid-break border-t pt-2 text-[10px] text-muted-foreground">
          Documento interno da rede Risarte · contém dados pessoais e de saúde
          (LGPD): compartilhe apenas com quem tem finalidade legítima. Os números
          refletem as unidades a que você tem acesso.
        </footer>
      </div>
    </>
  );
}
