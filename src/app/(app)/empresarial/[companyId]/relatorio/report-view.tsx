"use client";

import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj, formatCpf } from "@/lib/masks";
import {
  COMPANY_STATUS_LABELS,
  DEPENDENT_PLAN_LABELS,
  EMPLOYEE_STATUS_LABELS,
  LEFT_REASON_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODEL_LABELS,
  RELATIONSHIP_LABELS,
  type LeftReason,
} from "@/lib/empresarial/constants";
import { printAs, reportFileName } from "@/lib/empresarial/filenames";
import { REPORT_FILTER_LABELS } from "@/lib/empresarial/constants";
import type { CompanyReport } from "./data";

// PDF: esconde a tela (menu/botões) e imprime só o relatório.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #relatorio-empresa, #relatorio-empresa * { visibility: visible !important; }
  #relatorio-empresa { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

export function ReportView({ report }: { report: CompanyReport }) {
  const { company: c, totals, pricing, employees } = report;

  // Nome do arquivo já com empresa, filtro aplicado e data — para achar depois.
  const fileBaseName = () =>
    reportFileName(
      "relatorio-colaboradores",
      c.tradeName || c.legalName,
      report.filter === "ALL" ? null : REPORT_FILTER_LABELS[report.filter]
    );

  const addr = c.address;
  const addrText = addr
    ? [
        [addr.street, addr.number].filter(Boolean).join(", "),
        addr.complement,
        addr.neighborhood,
        [addr.city, addr.state].filter(Boolean).join(" - "),
        addr.zipCode,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  async function exportExcel() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Aba 1 — Empresa
      const empresa = XLSX.utils.aoa_to_sheet([
        ["RELATÓRIO — RISARTE EMPRESARIAL"],
        ["Gerado em", d(report.generatedAt)],
        [],
        ["Razão social", c.legalName],
        ["Nome fantasia", c.tradeName ?? ""],
        ["CNPJ", formatCnpj(c.cnpj)],
        ["Inscrição estadual", c.stateRegistration ?? ""],
        ["Situação", COMPANY_STATUS_LABELS[c.status]],
        ["Endereço", addrText ?? ""],
        ["Consultor RisLife", c.consultantName ?? ""],
        ["Modelo de pagamento", PAYMENT_MODEL_LABELS[c.paymentModel]],
        [
          "Meios de pagamento",
          c.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(", "),
        ],
        ["Dia de vencimento", c.dueDay],
        ["Parcelamento máximo", `${c.defaultMaxInstallments}x`],
        ["Início do contrato", d(c.contractStartedAt)],
        ["Carência da empresa (dias)", c.gracePeriodDays],
        ["Carência do colaborador (dias)", c.employeeGracePeriodDays],
        [],
        [`Preços de adesão (${report.pricingScope})`],
        ["Titular", (pricing.holderFeeCents / 100).toFixed(2)],
        ["Dependente individual", (pricing.dependentIndividualFeeCents / 100).toFixed(2)],
        ["Dependente familiar", (pricing.dependentFamilyFeeCents / 100).toFixed(2)],
        ["Familiar extra", (pricing.dependentFamilyExtraFeeCents / 100).toFixed(2)],
        [],
        ["Colaboradores ativos", totals.employeesActive],
        ["Colaboradores inativos", totals.employeesInactive],
        ["Dependentes ativos", totals.dependentsActive],
        ["Cadastros pendentes", totals.pendingRegistration],
        ["Mensalidade (R$)", (totals.monthlyCents / 100).toFixed(2)],
        ["Economia gerada (R$)", (totals.savedCents / 100).toFixed(2)],
        ["Benefícios utilizados", totals.benefitUses],
      ]);
      empresa["!cols"] = [{ wch: 32 }, { wch: 46 }];
      XLSX.utils.book_append_sheet(wb, empresa, "Empresa");

      // Aba 2 — Colaboradores
      const colab = XLSX.utils.aoa_to_sheet([
        [
          "Nome",
          "CPF",
          "Telefone",
          "E-mail",
          "Situação",
          "Cadastro",
          "Plano de dependentes",
          "Dependentes ativos",
          "Unidade",
          "Entrada",
          "Saída",
          "Motivo da saída",
          "Mensalidade (R$)",
        ],
        ...employees.map((e) => [
          e.fullName,
          formatCpf(e.cpf),
          e.phone,
          e.email ?? "",
          EMPLOYEE_STATUS_LABELS[e.status],
          e.registrationStage === "COMPLETED" ? "Completo" : "Pré-cadastrado",
          DEPENDENT_PLAN_LABELS[e.dependentPlan],
          e.dependents.filter((x) => x.status === "ACTIVE").length,
          e.clinicName ?? "",
          d(e.joinedAt),
          d(e.leftAt),
          e.leftReason
            ? LEFT_REASON_LABELS[e.leftReason as LeftReason] ?? e.leftReason
            : "",
          (e.monthlyCents / 100).toFixed(2),
        ]),
      ]);
      colab["!cols"] = [
        { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 10 },
        { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 18 }, { wch: 12 },
        { wch: 12 }, { wch: 20 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, colab, "Colaboradores");

      // Aba 3 — Dependentes
      const deps = XLSX.utils.aoa_to_sheet([
        ["Titular", "Dependente", "CPF", "Parentesco", "Telefone", "Situação", "Cliente vinculado"],
        ...employees.flatMap((e) =>
          e.dependents.map((dp) => [
            e.fullName,
            dp.fullName ?? "",
            formatCpf(dp.cpf),
            RELATIONSHIP_LABELS[dp.relationship],
            dp.phone ?? "",
            EMPLOYEE_STATUS_LABELS[dp.status],
            dp.linked ? "Sim" : "Não",
          ])
        ),
      ]);
      deps["!cols"] = [
        { wch: 28 }, { wch: 28 }, { wch: 16 }, { wch: 14 },
        { wch: 16 }, { wch: 10 }, { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, deps, "Dependentes");

      XLSX.writeFile(wb, `${fileBaseName()}.xlsx`);
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
            Relatório detalhado
          </h1>
          <p className="text-sm text-muted-foreground">
            Empresa, colaboradores e dependentes. Use “Imprimir / PDF” para enviar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download className="mr-1 size-4" />
            Excel
          </Button>
          <Button size="sm" onClick={() => printAs(fileBaseName())}>
            <Printer className="mr-1 size-4" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <div id="relatorio-empresa" className="space-y-5 text-foreground">
        {/* Cabeçalho */}
        <header className="avoid-break border-b pb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Risarte Empresarial — relatório detalhado
          </p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {c.tradeName || c.legalName}
            <Badge
              variant={
                c.status === "ACTIVE"
                  ? "secondary"
                  : c.status === "SUSPENDED"
                    ? "destructive"
                    : "outline"
              }
            >
              {COMPANY_STATUS_LABELS[c.status]}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatCnpj(c.cnpj)} · gerado em {d(report.generatedAt)}
          </p>
        </header>

        {/* Resumo */}
        <section className="avoid-break">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Resumo
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "Colaboradores ativos", v: String(totals.employeesActive) },
              { l: "Dependentes ativos", v: String(totals.dependentsActive) },
              { l: "Mensalidade", v: formatBRL(totals.monthlyCents) },
              { l: "Economia gerada", v: formatBRL(totals.savedCents) },
              { l: "Clientes vinculados", v: String(totals.linkedClients) },
              { l: "Cadastros pendentes", v: String(totals.pendingRegistration) },
              { l: "Inativos", v: String(totals.employeesInactive) },
              { l: "Benefícios usados", v: String(totals.benefitUses) },
            ].map((k) => (
              <div key={k.l} className="rounded-lg border p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {k.l}
                </p>
                <p className="mt-0.5 text-lg font-semibold">{k.v}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Dados da empresa */}
        <section className="avoid-break">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Dados da empresa
          </h3>
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Field label="Razão social" value={c.legalName} />
            <Field label="Nome fantasia" value={c.tradeName} />
            <Field label="Inscrição estadual" value={c.stateRegistration} />
            <Field
              label="Modelo de pagamento"
              value={PAYMENT_MODEL_LABELS[c.paymentModel]}
            />
            <Field
              label="Meios de pagamento"
              value={c.paymentMethods
                .map((m) => PAYMENT_METHOD_LABELS[m])
                .join(", ")}
            />
            <Field label="Dia de vencimento" value={c.dueDay} />
            <Field
              label="Parcelamento máximo"
              value={`${c.defaultMaxInstallments}x`}
            />
            <Field label="Início do contrato" value={d(c.contractStartedAt)} />
            <Field label="Consultor RisLife" value={c.consultantName} />
            <Field
              label="Carência da empresa"
              value={`${c.gracePeriodDays} dias`}
            />
            <Field
              label="Carência do colaborador"
              value={`${c.employeeGracePeriodDays} dias`}
            />
            <Field
              label="Colaboradores (informado)"
              value={c.employeeCount ?? "—"}
            />
            <div className="col-span-2 sm:col-span-3">
              <Field label="Endereço" value={addrText} />
            </div>
            {c.notes && (
              <div className="col-span-2 sm:col-span-3">
                <Field label="Observações" value={c.notes} />
              </div>
            )}
          </div>
        </section>

        {/* Preços aplicados */}
        <section className="avoid-break">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Preços de adesão aplicados{" "}
            <span className="font-normal normal-case text-muted-foreground">
              ({report.pricingScope === "empresa"
                ? "regra própria desta empresa"
                : "padrão da rede"})
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-4">
            <Field label="Titular" value={formatBRL(pricing.holderFeeCents)} />
            <Field
              label="Dep. individual"
              value={formatBRL(pricing.dependentIndividualFeeCents)}
            />
            <Field
              label="Dep. familiar (1–3)"
              value={formatBRL(pricing.dependentFamilyFeeCents)}
            />
            <Field
              label="Familiar extra"
              value={formatBRL(pricing.dependentFamilyExtraFeeCents)}
            />
          </div>
        </section>

        {/* Colaboradores + dependentes */}
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide">
            Colaboradores e dependentes ({employees.length})
          </h3>
          {/* Sai impresso: o leitor precisa saber que a lista está filtrada. */}
          <p className="mb-2 text-[10px] text-muted-foreground">
            Situação exibida: <strong>{report.filterLabel}</strong>. Os números do
            resumo consideram sempre a base completa da empresa.
          </p>
          {employees.length === 0 ? (
            <p className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              Nenhum colaborador nesta situação.
            </p>
          ) : (
            <div className="space-y-2">
              {employees.map((e, i) => (
                <div key={e.id} className="avoid-break rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        {e.fullName}
                        {e.status === "INACTIVE" ? (
                          <Badge variant="outline">Inativo</Badge>
                        ) : e.registrationStage === "COMPLETED" ? (
                          <Badge className="bg-gold/20 text-gold-foreground">
                            ★ Cliente vinculado
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Pré-cadastrado</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCpf(e.cpf)} · {e.phone}
                        {e.email ? ` · ${e.email}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-medium">
                        {DEPENDENT_PLAN_LABELS[e.dependentPlan]}
                      </p>
                      <p className="text-muted-foreground">
                        {e.status === "ACTIVE"
                          ? `${formatBRL(e.monthlyCents)}/mês`
                          : "não cobrado"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4">
                    <Field label="Unidade" value={e.clinicName} />
                    <Field label="Entrada" value={d(e.joinedAt)} />
                    <Field label="Saída" value={d(e.leftAt)} />
                    <Field
                      label="Motivo da saída"
                      value={
                        e.leftReason
                          ? LEFT_REASON_LABELS[e.leftReason as LeftReason] ??
                            e.leftReason
                          : "—"
                      }
                    />
                  </div>

                  {e.dependents.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Dependentes ({e.dependents.length})
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-2 font-medium">Nome</th>
                              <th className="py-1 pr-2 font-medium">CPF</th>
                              <th className="py-1 pr-2 font-medium">Parentesco</th>
                              <th className="py-1 pr-2 font-medium">Telefone</th>
                              <th className="py-1 pr-2 font-medium">Situação</th>
                              <th className="py-1 font-medium">Vinculado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.dependents.map((dp) => (
                              <tr key={dp.id} className="border-t">
                                <td className="py-1 pr-2">
                                  {dp.fullName || "—"}
                                </td>
                                <td className="py-1 pr-2">{formatCpf(dp.cpf)}</td>
                                <td className="py-1 pr-2">
                                  {RELATIONSHIP_LABELS[dp.relationship]}
                                </td>
                                <td className="py-1 pr-2">{dp.phone || "—"}</td>
                                <td className="py-1 pr-2">
                                  {EMPLOYEE_STATUS_LABELS[dp.status]}
                                </td>
                                <td className="py-1">
                                  {dp.linked ? "Sim" : "Não"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="avoid-break border-t pt-2 text-[10px] text-muted-foreground">
          Documento interno da rede Risarte · contém dados pessoais (LGPD):
          compartilhe apenas com quem tem finalidade legítima.
        </footer>
      </div>
    </>
  );
}
