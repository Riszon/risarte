"use client";

import { useEffect, useState } from "react";
import { Download, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj, formatCpf, formatPhone } from "@/lib/masks";
import { whatsappLink } from "@/lib/whatsapp";
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

/** Opções de conteúdo do relatório (o dono escolhe antes de gerar o PDF). */
type Options = {
  showFull: boolean;
  showCharged: boolean;
  showProcedureDetail: boolean;
};

function d(iso: string | null): string {
  if (!iso) return "—";
  const date = iso.length <= 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  return date.toLocaleDateString("pt-BR");
}

function hm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

  // Valores financeiros começam OCULTOS (decisão do dono: são opcionais).
  const [opt, setOpt] = useState<Options>({
    showFull: false,
    showCharged: false,
    showProcedureDetail: false,
  });
  const [askPrint, setAskPrint] = useState(false);
  const [askWhats, setAskWhats] = useState(false);
  const [phone, setPhone] = useState("");
  const [pendingPrint, setPendingPrint] = useState(false);

  // Imprime só depois que as opções escolhidas já estão na tela.
  useEffect(() => {
    if (!pendingPrint) return;
    setPendingPrint(false);
    const timer = setTimeout(() => window.print(), 80);
    return () => clearTimeout(timer);
  }, [pendingPrint]);

  const companyLabel = c.tradeName || c.legalName;

  function confirmPrint(chosen: Options) {
    setOpt(chosen);
    setAskPrint(false);
    setPendingPrint(true);
  }

  function sendWhatsapp() {
    const msg =
      `*Risarte Empresarial — benefícios e economia*\n` +
      `Empresa: ${companyLabel}\n` +
      `Período: até ${d(report.generatedAt)}\n\n` +
      `• Economia gerada: ${formatBRL(t.savedCents)}\n` +
      `• Benefícios utilizados: ${t.usageCount}\n` +
      `• Beneficiários atendidos: ${t.membersWithUsage} de ${members.length}\n` +
      `• Sessões realizadas: ${t.sessionsDone} · em aberto: ${t.sessionsOpen}\n` +
      `• Procedimentos concluídos: ${t.proceduresDone} · em aberto: ${t.proceduresOpen}\n\n` +
      `O relatório completo em PDF segue anexo.`;
    const link = phone.trim()
      ? whatsappLink(phone, msg)
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    if (!link) {
      toast.error("Telefone inválido — inclua o DDD.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    setAskWhats(false);
  }

  async function exportExcel() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const resumo = XLSX.utils.aoa_to_sheet([
        ["EXTRATO DE BENEFÍCIOS — RISARTE EMPRESARIAL"],
        ["Empresa", companyLabel],
        ["CNPJ", formatCnpj(c.cnpj)],
        ["Gerado em", d(report.generatedAt)],
        [],
        ["Economia gerada (R$)", (t.savedCents / 100).toFixed(2)],
        ["Valor cheio dos procedimentos (R$)", (t.fullCents / 100).toFixed(2)],
        ["Valor pago pelos beneficiários (R$)", (t.chargedCents / 100).toFixed(2)],
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

      const porPessoa = XLSX.utils.aoa_to_sheet([
        [
          "Nome", "CPF", "Vínculo", "Situação", "Unidade",
          "Economia (R$)", "Valor cheio (R$)", "Pago (R$)", "Benefícios usados",
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
          (m.savedCents / 100).toFixed(2),
          (m.fullCents / 100).toFixed(2),
          (m.chargedCents / 100).toFixed(2),
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
        { wch: 14 }, { wch: 15 }, { wch: 12 }, { wch: 16 },
        { wch: 14 }, { wch: 16 }, { wch: 17 }, { wch: 16 },
        { wch: 13 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 9 },
      ];
      XLSX.utils.book_append_sheet(wb, porPessoa, "Por beneficiário");

      // Extrato: atendimento por atendimento (sem nome de procedimento).
      const extrato = XLSX.utils.aoa_to_sheet([
        [
          "Beneficiário", "Vínculo", "Data do atendimento", "Chegada (check-in)",
          "Fim do atendimento", "Economia (R$)",
        ],
        ...members.flatMap((m) =>
          m.usages.map((u) => [
            m.name,
            memberRole(m),
            d(u.date),
            hm(u.checkInAt),
            hm(u.doneAt),
            (u.savedCents / 100).toFixed(2),
          ])
        ),
      ]);
      extrato["!cols"] = [
        { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, extrato, "Extrato");

      const safe = companyLabel
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

      <div className="no-print mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
            <Button variant="outline" size="sm" onClick={() => setAskWhats(true)}>
              <MessageCircle className="mr-1 size-4" />
              WhatsApp
            </Button>
            <Button size="sm" onClick={() => setAskPrint(true)}>
              <Printer className="mr-1 size-4" />
              Imprimir / PDF
            </Button>
          </div>
        </div>

        {/* Campos opcionais direto na tela (o PDF pergunta antes de gerar). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            Mostrar também:
          </span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={opt.showFull}
              onChange={(e) => setOpt({ ...opt, showFull: e.target.checked })}
            />
            Valor cheio
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={opt.showCharged}
              onChange={(e) => setOpt({ ...opt, showCharged: e.target.checked })}
            />
            Pago pelos beneficiários
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={opt.showProcedureDetail}
              onChange={(e) =>
                setOpt({ ...opt, showProcedureDetail: e.target.checked })
              }
            />
            Detalhar procedimentos (nomes)
          </label>
        </div>
      </div>

      <div id="extrato-beneficios" className="space-y-5">
        <header className="avoid-break border-b pb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Risarte Empresarial — extrato de benefícios e economia
          </p>
          <h2 className="mt-0.5 text-2xl font-semibold">{companyLabel}</h2>
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Economia total" value={formatBRL(t.savedCents)} gold />
                <Kpi label="Benefícios usados" value={String(t.usageCount)} />
                <Kpi
                  label="Beneficiários que usaram"
                  value={`${t.membersWithUsage} de ${members.length}`}
                />
                {opt.showFull && (
                  <Kpi label="Valor cheio" value={formatBRL(t.fullCents)} />
                )}
                {opt.showCharged && (
                  <Kpi
                    label="Pago pelos beneficiários"
                    value={formatBRL(t.chargedCents)}
                  />
                )}
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
                      {opt.showFull && (
                        <th className="px-2 py-2 font-medium">Valor cheio</th>
                      )}
                      {opt.showCharged && (
                        <th className="px-2 py-2 font-medium">Pagou</th>
                      )}
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
                      <tr key={m.clientId} className="border-b last:border-0 align-top">
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
                        {opt.showFull && (
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatBRL(m.fullCents)}
                          </td>
                        )}
                        {opt.showCharged && (
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatBRL(m.chargedCents)}
                          </td>
                        )}
                        <td className="px-2 py-1.5 tabular-nums">
                          {m.sessionsDone} / {m.sessionsOpen}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {m.proceduresDone} / {m.proceduresOpen}
                          {opt.showProcedureDetail &&
                            (m.doneProcedureNames.length > 0 ||
                              m.openProcedureNames.length > 0) && (
                              <span className="mt-0.5 block text-[10px] font-normal leading-tight text-muted-foreground">
                                {m.doneProcedureNames.length > 0 && (
                                  <span className="block">
                                    Concluídos: {m.doneProcedureNames.join(", ")}
                                  </span>
                                )}
                                {m.openProcedureNames.length > 0 && (
                                  <span className="block">
                                    Em aberto: {m.openProcedureNames.join(", ")}
                                  </span>
                                )}
                              </span>
                            )}
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

            {/* Extrato por atendimento */}
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                Extrato de economia por beneficiário
              </h3>
              <p className="mb-2 text-[10px] text-muted-foreground">
                Chegada e fim aparecem quando o procedimento já foi atendido (vêm
                do check-in e da conclusão no painel de Atendimento). Benefício
                lançado no fechamento e ainda não atendido fica sem horário.
              </p>
              {withUsage.length === 0 ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Nenhum benefício registrado até agora. A economia é registrada
                  no fechamento — pelo fluxo do comercial ou pela venda direta.
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
                              <th className="py-1 pr-2 font-medium">Atendimento</th>
                              <th className="py-1 pr-2 font-medium">Chegada</th>
                              <th className="py-1 pr-2 font-medium">Fim</th>
                              {opt.showFull && (
                                <th className="py-1 pr-2 text-right font-medium">
                                  Valor cheio
                                </th>
                              )}
                              {opt.showCharged && (
                                <th className="py-1 pr-2 text-right font-medium">
                                  Pagou
                                </th>
                              )}
                              <th className="py-1 text-right font-medium">
                                Economizou
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.usages.map((u, i) => (
                              <tr key={i} className="border-t">
                                <td className="py-1 pr-2">
                                  {d(u.date)}
                                  {!u.hasAttendance && (
                                    <span className="block text-[10px] text-muted-foreground">
                                      lançado no fechamento
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 pr-2 tabular-nums">
                                  {hm(u.checkInAt)}
                                </td>
                                <td className="py-1 pr-2 tabular-nums">
                                  {hm(u.doneAt)}
                                </td>
                                {opt.showFull && (
                                  <td className="py-1 pr-2 text-right tabular-nums">
                                    {formatBRL(u.fullCents)}
                                  </td>
                                )}
                                {opt.showCharged && (
                                  <td className="py-1 pr-2 text-right tabular-nums">
                                    {formatBRL(u.chargedCents)}
                                  </td>
                                )}
                                <td className="py-1 text-right font-medium tabular-nums text-gold">
                                  {formatBRL(u.savedCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t font-medium">
                              <td className="py-1 pr-2" colSpan={3}>
                                Total ({m.usages.length} atendimento
                                {m.usages.length === 1 ? "" : "s"})
                              </td>
                              {opt.showFull && (
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {formatBRL(m.fullCents)}
                                </td>
                              )}
                              {opt.showCharged && (
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {formatBRL(m.chargedCents)}
                                </td>
                              )}
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

      {/* Pop-up: o que entra no PDF que será enviado */}
      <PrintOptionsDialog
        open={askPrint}
        current={opt}
        onCancel={() => setAskPrint(false)}
        onConfirm={confirmPrint}
      />

      {/* Pop-up: enviar por WhatsApp */}
      <Dialog open={askWhats} onOpenChange={setAskWhats}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar relatório por WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O WhatsApp não aceita anexo por link. Então funciona assim:
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>
                Gere o PDF em <strong>Imprimir / PDF</strong> e salve no
                computador.
              </li>
              <li>
                Clique em <strong>Abrir WhatsApp</strong> — a mensagem com o
                resumo já vai pronta.
              </li>
              <li>Anexe o PDF salvo na conversa e envie.</li>
            </ol>
            <div>
              <Label htmlFor="whats_phone">
                Telefone com DDD (opcional — em branco você escolhe o contato)
              </Label>
              <Input
                id="whats_phone"
                value={phone}
                placeholder="(00) 00000-0000"
                onChange={(e) => setPhone(formatPhone(e.target.value))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAskWhats(false)}>
                Cancelar
              </Button>
              <Button onClick={sendWhatsapp}>
                <MessageCircle className="mr-1 size-4" />
                Abrir WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Pergunta o que entra no relatório antes de gerar o PDF. */
function PrintOptionsDialog({
  open,
  current,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current: Options;
  onCancel: () => void;
  onConfirm: (o: Options) => void;
}) {
  const [local, setLocal] = useState<Options>(current);

  // Reabrir o pop-up parte das opções que estão na tela.
  useEffect(() => {
    if (open) setLocal(current);
  }, [open, current]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>O que entra no relatório?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Marque o que deve aparecer no PDF que será enviado. Desmarcado, o
            relatório mostra só a economia.
          </p>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={local.showFull}
                onChange={(e) => setLocal({ ...local, showFull: e.target.checked })}
              />
              <span>
                <strong>Valor cheio</strong> dos procedimentos
                <span className="block text-xs text-muted-foreground">
                  Quanto custaria sem o programa.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={local.showCharged}
                onChange={(e) =>
                  setLocal({ ...local, showCharged: e.target.checked })
                }
              />
              <span>
                <strong>Pago pelos beneficiários</strong>
                <span className="block text-xs text-muted-foreground">
                  Quanto cada um desembolsou.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={local.showProcedureDetail}
                onChange={(e) =>
                  setLocal({ ...local, showProcedureDetail: e.target.checked })
                }
              />
              <span>
                <strong>Detalhar procedimentos</strong> (nomes)
                <span className="block text-xs text-muted-foreground">
                  Lista os procedimentos concluídos e em aberto de cada
                  beneficiário.
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button onClick={() => onConfirm(local)}>
              <Printer className="mr-1 size-4" />
              Gerar PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
