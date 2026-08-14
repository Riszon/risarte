"use client";

import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj } from "@/lib/masks";
import {
  BILLING_STATUS_LABELS,
  BILLING_TYPE_LABELS,
  BENEFIT_TYPE_LABELS,
  COMPANY_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODEL_LABELS,
} from "@/lib/empresarial/constants";
import {
  BILLING_MODEL_LABELS,
  COMPANY_CATEGORY_LABELS,
  COMPANY_FILE_TYPE_LABELS,
} from "@/lib/empresarial/documents";
import type { CompanySheet } from "./data";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #ficha-empresa, #ficha-empresa * { visibility: visible !important; }
  #ficha-empresa { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
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

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="avoid-break">
      <h3 className="mb-2 border-b pb-1 text-sm font-semibold uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function CompanySheetView({ sheet }: { sheet: CompanySheet }) {
  const { company: c, program: p } = sheet;
  const name = c.tradeName || c.legalName;

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

  const subsidy =
    c.paymentModel === "COMPANY_PARTIAL" && c.subsidyValue
      ? c.subsidyType === "PERCENT"
        ? `${c.subsidyValue}%`
        : formatBRL(c.subsidyValue)
      : null;

  function benefitText(b: CompanySheet["benefits"][number]): string {
    const parts: string[] = [];
    if (b.benefitType === "DISCOUNT_PERCENT")
      parts.push(`${b.benefitValue ?? 0}% de desconto`);
    else if (b.benefitType === "DISCOUNT_AMOUNT")
      parts.push(`${formatBRL(b.benefitValue ?? 0)} de desconto`);
    else parts.push(BENEFIT_TYPE_LABELS[b.benefitType]);
    if (b.usageLimitCount != null)
      parts.push(
        `${b.usageLimitCount}x${b.usagePeriodMonths ? ` a cada ${b.usagePeriodMonths} meses` : ""}`
      );
    else if (b.usagePeriodMonths)
      parts.push(`a cada ${b.usagePeriodMonths} meses`);
    if (b.gracePeriodMonths > 0)
      parts.push(`carência de ${b.gracePeriodMonths} meses`);
    if (b.maxInstallments) parts.push(`até ${b.maxInstallments}x`);
    return parts.join(" · ");
  }

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Ficha da empresa
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos os dados cadastrados sobre a empresa, prontos para imprimir.
          </p>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 size-4" />
          Imprimir / PDF
        </Button>
      </div>

      <div id="ficha-empresa" className="space-y-5">
        <header className="avoid-break border-b pb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Risarte Empresarial — ficha da empresa
          </p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {name}
            <Badge
              variant={c.status === "ACTIVE" ? "secondary" : "outline"}
              className="text-xs"
            >
              {COMPANY_STATUS_LABELS[c.status]}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatCnpj(c.cnpj)} · gerado em {d(sheet.generatedAt)}
          </p>
        </header>

        {/* Números do programa */}
        <Section title="O programa nesta empresa">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Pessoas", value: String(p.total) },
              { label: "Titulares", value: String(p.holders) },
              { label: "Dependentes", value: String(p.dependents) },
              { label: "Mensalidade", value: formatBRL(p.monthlyCents) },
              { label: "Economia gerada", value: formatBRL(p.savedCents) },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border p-2.5">
                <p className="text-[10px] uppercase text-muted-foreground">
                  {k.label}
                </p>
                <p className="mt-0.5 text-lg font-semibold">{k.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {p.inactiveHolders} titular(es) inativo(s) · {p.benefitUses}{" "}
            benefício(s) utilizado(s). Números consideram apenas pessoas ativas.
          </p>
        </Section>

        {/* Cadastro */}
        <Section title="Cadastro">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Info label="Razão social" value={c.legalName} />
            <Info label="Nome fantasia" value={c.tradeName} />
            <Info
              label="Categoria"
              value={COMPANY_CATEGORY_LABELS[c.category]}
            />
            <Info label="Inscrição estadual" value={c.stateRegistration} />
            <Info
              label="Colaboradores (informado)"
              value={c.employeeCount != null ? String(c.employeeCount) : null}
            />
            <Info label="Cadastrada em" value={d(c.createdAt)} />
            <div className="col-span-2 sm:col-span-3">
              <Info label="Endereço" value={addrText} />
            </div>
          </div>
        </Section>

        {/* Documentos */}
        <Section title={`Documentos (${sheet.documents.length})`}>
          {sheet.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum documento cadastrado.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Documento</th>
                  <th className="py-1 pr-2 font-medium">Identificação</th>
                  <th className="py-1 pr-2 font-medium">Titular (CAEPF)</th>
                  <th className="py-1 text-right font-medium">Colaboradores</th>
                </tr>
              </thead>
              <tbody>
                {sheet.documents.map((doc, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <span className="font-mono">{doc.docFormatted}</span>{" "}
                      <span className="text-[10px] text-muted-foreground">
                        {doc.docType}
                      </span>
                      {doc.isPrimary && (
                        <span className="ml-1 text-[10px] text-gold">
                          ★ principal
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {doc.nickname ?? "—"}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {doc.holderCpf ?? "—"}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {doc.employees}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Responsável */}
        <Section title="Responsável pela empresa">
          {c.responsibleName ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Info label="Nome" value={c.responsibleName} />
              <Info label="Cargo" value={c.responsibleRole} />
              <Info label="CPF" value={c.responsibleCpf} />
              <Info label="Telefone" value={c.responsiblePhone} />
              <div className="col-span-2">
                <Info label="E-mail" value={c.responsibleEmail} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum responsável informado.
            </p>
          )}
        </Section>

        {/* Contrato e pagamento */}
        <Section title="Contrato e pagamento">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Info
              label="Modelo de pagamento"
              value={PAYMENT_MODEL_LABELS[c.paymentModel]}
            />
            {subsidy && <Info label="Subsídio da empresa" value={subsidy} />}
            <Info
              label="Faturamento"
              value={BILLING_MODEL_LABELS[c.billingModel]}
            />
            <Info label="Dia de vencimento" value={String(c.dueDay)} />
            <Info
              label="Parcelamento máximo"
              value={`${c.defaultMaxInstallments}x`}
            />
            <Info
              label="Meios de pagamento"
              value={
                c.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(", ") ||
                "—"
              }
            />
            <Info label="Início do contrato" value={d(c.contractStartedAt)} />
            <Info
              label="Carência da empresa"
              value={`${c.gracePeriodDays} dias`}
            />
            <Info
              label="Carência do colaborador"
              value={`${c.employeeGracePeriodDays} dias`}
            />
            <Info label="Consultor RisLife" value={c.consultantName} />
          </div>
        </Section>

        {/* Preços e split */}
        <Section title="Preços de adesão e divisão do pagamento">
          <p className="mb-1.5 text-[10px] text-muted-foreground">
            Preços: {sheet.pricingScope === "empresa" ? "próprios desta empresa" : "padrão da rede"} ·
            Split: {sheet.splitScope === "empresa" ? "próprio desta empresa" : "padrão da rede"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Titular" value={formatBRL(sheet.pricing.holderFeeCents)} />
            <Info
              label="Dependente individual"
              value={formatBRL(sheet.pricing.dependentIndividualFeeCents)}
            />
            <Info
              label="Dependente familiar (1–3)"
              value={formatBRL(sheet.pricing.dependentFamilyFeeCents)}
            />
            <Info
              label="Familiar extra (cada)"
              value={formatBRL(sheet.pricing.dependentFamilyExtraFeeCents)}
            />
            <Info
              label="1º pagamento"
              value={`${sheet.split.firstPaymentRisartePct}% Risarte / ${sheet.split.firstPaymentRislifePct}% RisLife`}
            />
            <Info
              label="Mensalidades"
              value={`${sheet.split.recurringRisartePct}% Risarte / ${sheet.split.recurringRislifePct}% RisLife`}
            />
          </div>
        </Section>

        {/* Benefícios */}
        <Section title={`Benefícios do programa (${sheet.benefits.length})`}>
          {sheet.benefits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum benefício configurado.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Procedimento</th>
                  <th className="py-1 pr-2 font-medium">Benefício</th>
                  <th className="py-1 text-right font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {sheet.benefits.map((b, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-medium">{b.procedureName}</td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {benefitText(b)}
                    </td>
                    <td className="py-1 text-right text-[10px] text-muted-foreground">
                      {b.scope === "empresa" ? "desta empresa" : "padrão da rede"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Cobranças */}
        {sheet.billings.length > 0 && (
          <Section title="Últimas cobranças">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Tipo</th>
                  <th className="py-1 pr-2 font-medium">Referência</th>
                  <th className="py-1 pr-2 font-medium">Vencimento</th>
                  <th className="py-1 pr-2 font-medium">Situação</th>
                  <th className="py-1 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sheet.billings.map((b, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      {BILLING_TYPE_LABELS[b.billingType]}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {b.referenceMonth
                        ? new Date(
                            b.referenceMonth + "T00:00:00"
                          ).toLocaleDateString("pt-BR", {
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {d(b.dueDate)}
                    </td>
                    <td className="py-1 pr-2">
                      {BILLING_STATUS_LABELS[b.status]}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatBRL(b.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Contratos e arquivos */}
        <Section title="Contratos e arquivos">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] uppercase text-muted-foreground">
                Contratos ({sheet.contracts.length})
              </p>
              {sheet.contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {sheet.contracts.map((ct, i) => (
                    <li key={i}>
                      {ct.title}{" "}
                      <span className="text-xs text-muted-foreground">
                        {ct.status === "SIGNED"
                          ? `assinado em ${d(ct.signedAt)}`
                          : ct.status.toLowerCase()}
                        {ct.signerName ? ` · ${ct.signerName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-muted-foreground">
                Arquivos ({sheet.files.length})
              </p>
              {sheet.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum arquivo.</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {sheet.files.map((f, i) => (
                    <li key={i}>
                      {f.fileName}{" "}
                      <span className="text-xs text-muted-foreground">
                        (
                        {COMPANY_FILE_TYPE_LABELS[
                          f.fileType as keyof typeof COMPANY_FILE_TYPE_LABELS
                        ] ?? f.fileType}
                        , {d(f.createdAt)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>

        {c.notes && (
          <Section title="Observações">
            <p className="whitespace-pre-wrap text-sm">{c.notes}</p>
          </Section>
        )}

        <footer className="avoid-break border-t pt-2 text-[10px] text-muted-foreground">
          Documento interno da rede Risarte · contém dados cadastrais e
          financeiros da empresa parceira (LGPD): compartilhe apenas com quem tem
          finalidade legítima.
        </footer>
      </div>
    </>
  );
}
