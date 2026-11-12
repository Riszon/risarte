"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampoHerdado } from "@/components/central/campo-herdado";
import { computeLateCharges } from "@/lib/finance/late-fees";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { clearFinanceSettings, saveFinanceSettings } from "../financeiro/actions";

/**
 * A ABA FINANCEIRO DA CENTRAL (ASA1, entrega 1) — multa, juros, arredondamento
 * e o teto da inadimplência. Era Financeiro › Cadastros › Configuração; as
 * tabelas e as regras de quem grava são as mesmas (`finance_settings`, só o
 * Admin Master e o Financeiro da Franqueadora gravam).
 *
 * ⚠️ HERANÇA CAMPO A CAMPO NA UNIDADE: campo VAZIO segue a rede (a coluna fica
 * nula, como a 0230 permite). Antes a unidade copiava todos os valores ao
 * salvar e deixava de acompanhar a rede sem ninguém perceber.
 *
 * ⚠️ CARÊNCIA FIXA EM ZERO (4003): o Asaas não aplica carência — o campo só
 * mostra o valor e a explicação.
 */

export type ValoresDaRede = {
  late_fee_percent: number;
  monthly_interest_percent: number;
  rounding_mode: "half_up" | "half_even";
  alert_overdue_percent: number | null;
  /** 4004 — dias da nova cobrança de parcela vencida; `null` = banco sem a 4004. */
  overdue_reissue_max_days?: number | null;
  /** 4005 — arredondamento automático do Asaas, em centavos; `null` = banco sem a 4005. */
  gateway_rounding_tolerance_cents?: number | null;
};

/** A linha da unidade, crua: `null` = segue a rede. */
export type ValoresDaUnidade = {
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  rounding_mode: "half_up" | "half_even" | null;
  alert_overdue_percent: number | null;
};

const fieldClass = "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const ROUNDING: Record<"half_up" | "half_even", string> = {
  half_up: "Meio para cima",
  half_even: "Meio par (bancário)",
};
const num = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
};
const texto = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

export const EXPLICACAO_DA_CARENCIA =
  "o Asaas não aplica carência; multa e juros contam do dia seguinte ao vencimento";

function Carencia() {
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">Carência</span>
      <p className="rounded-lg border bg-muted/40 px-2.5 py-2 text-sm">
        0 dia <span className="text-xs text-muted-foreground">— fixa: {EXPLICACAO_DA_CARENCIA}.</span>
      </p>
    </div>
  );
}

function Exemplo({ multa, juros, arredondamento }: { multa: number; juros: number; arredondamento: "half_up" | "half_even" }) {
  const exemplo = computeLateCharges({
    principalCents: 100000,
    dueDate: "2026-06-30",
    referenceDate: "2026-07-30",
    terms: { lateFeePercent: multa, monthlyInterestPercent: juros, graceDays: 0, roundingMode: arredondamento },
  });
  return (
    <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
      <strong>Como fica:</strong> uma parcela de {formatBRL(100000)} com <strong>30 dias</strong> de atraso vira{" "}
      <strong>{formatBRL(exemplo.totalCents)}</strong> — multa {formatBRL(exemplo.lateFeeCents)} + juros{" "}
      {formatBRL(exemplo.interestCents)}.
    </p>
  );
}

function AvisoDaMulta() {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        A multa não pode passar de <strong>2%</strong> — é o limite do Código de Defesa do Consumidor (art. 52, §1º) para
        contrato parcelado. O sistema recusa o salvamento.
      </span>
    </p>
  );
}

function useSalvar() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  function salvar(input: Parameters<typeof saveFinanceSettings>[0], ok: string) {
    iniciar(async () => {
      const r = await saveFinanceSettings(input);
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }
  function limpar(clinicId: string) {
    iniciar(async () => {
      const r = await clearFinanceSettings(clinicId);
      if (r.ok) {
        toast.success("A unidade voltou a seguir o padrão da rede em tudo.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }
  return { pendente, salvar, limpar };
}

/** O nível REDE: os valores que toda unidade segue. Todos obrigatórios. */
export function FinanceiroDaRede({
  rede,
  titulo = "Padrão da rede",
  subtitulo = "Vale para toda unidade que não tiver valor próprio.",
  clinicId = null,
  canEdit,
}: {
  rede: ValoresDaRede;
  titulo?: string;
  subtitulo?: string;
  /** A franqueadora tem uma linha própria (as cobranças dela); nulo = a rede. */
  clinicId?: string | null;
  canEdit: boolean;
}) {
  const { pendente, salvar } = useSalvar();
  const [multa, setMulta] = useState(texto(rede.late_fee_percent));
  const [juros, setJuros] = useState(texto(rede.monthly_interest_percent));
  const [arred, setArred] = useState(rede.rounding_mode);
  const [teto, setTeto] = useState(texto(rede.alert_overdue_percent));
  // 4004: só a REDE tem o limite da reemissão (a linha da franqueadora não).
  const temReemissao = clinicId === null && rede.overdue_reissue_max_days != null;
  const [reemissao, setReemissao] = useState(String(rede.overdue_reissue_max_days ?? 7));
  const m = num(multa);
  const j = num(juros);
  const t = num(teto);
  const d = Number(reemissao);
  // 4005: o arredondamento automático do pagamento pelo Asaas (só na REDE).
  const temArredondamento = clinicId === null && rede.gateway_rounding_tolerance_cents != null;
  const [arredondamento, setArredondamento] = useState(
    ((rede.gateway_rounding_tolerance_cents ?? 10) / 100).toFixed(2).replace(".", ",")
  );
  const arredNum = num(arredondamento);
  const arredCents = arredNum === null || Number.isNaN(arredNum) ? Number.NaN : Math.round(arredNum * 100);
  const arredInvalido = temArredondamento && (!Number.isInteger(arredCents) || arredCents < 0 || arredCents > 500);
  const reemissaoInvalida = temReemissao && (!Number.isInteger(d) || d < 0 || d > 30);
  const invalido =
    m === null || j === null || Number.isNaN(m) || Number.isNaN(j) || Number.isNaN(t ?? 0) || reemissaoInvalida || arredInvalido;
  const acimaDoLimite = (m ?? 0) > 2;

  return (
    <Card className={cn(pendente && "opacity-70")}>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Multa (%)
            <input value={multa} onChange={(e) => setMulta(e.target.value)} disabled={!canEdit} inputMode="decimal" className={cn(fieldClass, acimaDoLimite && "border-destructive")} />
          </label>
          <label className="block text-sm font-medium">
            Juros ao mês (%)
            <input value={juros} onChange={(e) => setJuros(e.target.value)} disabled={!canEdit} inputMode="decimal" className={fieldClass} />
          </label>
          <label className="block text-sm font-medium">
            Arredondamento
            <select value={arred} onChange={(e) => setArred(e.target.value as "half_up" | "half_even")} disabled={!canEdit} className={fieldClass}>
              <option value="half_up">{ROUNDING.half_up}</option>
              <option value="half_even">{ROUNDING.half_even}</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Teto da inadimplência (%)
            <input value={teto} onChange={(e) => setTeto(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex.: 5" className={fieldClass} />
          </label>
          <Carencia />
          {temReemissao && (
            <label className="block text-sm font-medium">
              Nova cobrança de parcela vencida: até quantos dias (0 a 30)
              <input
                value={reemissao}
                onChange={(e) => setReemissao(e.target.value)}
                disabled={!canEdit}
                inputMode="numeric"
                className={cn(fieldClass, reemissaoInvalida && "border-destructive")}
              />
              <span className="block text-[11px] font-normal text-muted-foreground">
                O Asaas não aceita vencimento no passado: a parcela vencida ganha nova data de hoje até este limite, com
                multa e juros até a nova data. Acima disso, só renegociando.
              </span>
            </label>
          )}
          {temArredondamento && (
            <label className="block text-sm font-medium">
              Arredondamento automático do Asaas (R$, até 5,00)
              <input
                value={arredondamento}
                onChange={(e) => setArredondamento(e.target.value)}
                disabled={!canEdit}
                inputMode="decimal"
                className={cn(fieldClass, arredInvalido && "border-destructive")}
              />
              <span className="block text-[11px] font-normal text-muted-foreground">
                Quando o pagamento pelo Asaas vem até este valor ABAIXO do devido, a parcela fecha sozinha, registrada como
                arredondamento (não é dispensa). Acima disso, o saldo fica em aberto e o Gerente é avisado.
              </span>
            </label>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Teto da inadimplência: acima dele a unidade acende em <strong>Recebíveis</strong> e no painel da rede. Não é um
          índice de mercado — é a decisão da rede sobre o que considera aceitável.
        </p>
        {acimaDoLimite && <AvisoDaMulta />}
        {!invalido && <Exemplo multa={m!} juros={j!} arredondamento={arred} />}
        {canEdit && (
          <Button
            size="sm"
            disabled={invalido || acimaDoLimite || pendente}
            onClick={() =>
              salvar(
                {
                  clinicId,
                  lateFeePercent: m,
                  monthlyInterestPercent: j,
                  roundingMode: arred,
                  overduePercent: t,
                  ...(temReemissao ? { reissueMaxDays: d } : {}),
                  ...(temArredondamento ? { roundingToleranceCents: arredCents } : {}),
                },
                "Configuração salva."
              )
            }
          >
            Salvar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** O nível UNIDADE: cada campo vazio segue a rede. */
export function FinanceiroDaUnidade({
  clinicId,
  rede,
  propria,
  canEdit,
  titulo = "Esta unidade",
}: {
  titulo?: string;
  clinicId: string;
  rede: ValoresDaRede;
  /** Nulo = a unidade não tem linha própria (segue a rede em tudo). */
  propria: ValoresDaUnidade | null;
  canEdit: boolean;
}) {
  const { pendente, salvar, limpar } = useSalvar();
  const [multa, setMulta] = useState(texto(propria?.late_fee_percent ?? null));
  const [juros, setJuros] = useState(texto(propria?.monthly_interest_percent ?? null));
  const [arred, setArred] = useState<"" | "half_up" | "half_even">(propria?.rounding_mode ?? "");
  const [teto, setTeto] = useState(texto(propria?.alert_overdue_percent ?? null));
  const m = num(multa);
  const j = num(juros);
  const t = num(teto);
  const invalido = [m, j, t].some((v) => v !== null && Number.isNaN(v));
  const acimaDoLimite = (m ?? 0) > 2;
  const origem = (v: string) => (v.trim() === "" ? "herdado" : "personalizado") as "herdado" | "personalizado";
  const voltar = (limparCampo: () => void) =>
    canEdit ? (
      <button type="button" className="text-[11px] text-primary underline-offset-2 hover:underline" onClick={limparCampo}>
        voltar ao padrão
      </button>
    ) : null;

  return (
    <Card className={cn(pendente && "opacity-70")}>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Campo vazio segue o padrão da rede. Só preencha o que for diferente aqui.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoHerdado rotulo="Multa (%)" origem={origem(multa)} valorDaRede={`${texto(rede.late_fee_percent)}%`} voltarAoPadrao={voltar(() => setMulta(""))}>
            <input value={multa} onChange={(e) => setMulta(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder={`segue a rede (${texto(rede.late_fee_percent)}%)`} className={cn(fieldClass, acimaDoLimite && "border-destructive")} />
          </CampoHerdado>
          <CampoHerdado rotulo="Juros ao mês (%)" origem={origem(juros)} valorDaRede={`${texto(rede.monthly_interest_percent)}%`} voltarAoPadrao={voltar(() => setJuros(""))}>
            <input value={juros} onChange={(e) => setJuros(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder={`segue a rede (${texto(rede.monthly_interest_percent)}%)`} className={fieldClass} />
          </CampoHerdado>
          <CampoHerdado rotulo="Arredondamento" origem={origem(arred)} valorDaRede={ROUNDING[rede.rounding_mode]} voltarAoPadrao={voltar(() => setArred(""))}>
            <select value={arred} onChange={(e) => setArred(e.target.value as "" | "half_up" | "half_even")} disabled={!canEdit} className={fieldClass}>
              <option value="">segue a rede ({ROUNDING[rede.rounding_mode]})</option>
              <option value="half_up">{ROUNDING.half_up}</option>
              <option value="half_even">{ROUNDING.half_even}</option>
            </select>
          </CampoHerdado>
          <CampoHerdado
            rotulo="Teto da inadimplência (%)"
            origem={origem(teto)}
            valorDaRede={rede.alert_overdue_percent === null ? null : `${texto(rede.alert_overdue_percent)}%`}
            voltarAoPadrao={voltar(() => setTeto(""))}
          >
            <input value={teto} onChange={(e) => setTeto(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder={rede.alert_overdue_percent === null ? "segue a rede" : `segue a rede (${texto(rede.alert_overdue_percent)}%)`} className={fieldClass} />
          </CampoHerdado>
          <Carencia />
        </div>
        {acimaDoLimite && <AvisoDaMulta />}
        {!invalido && (
          <Exemplo
            multa={m ?? rede.late_fee_percent}
            juros={j ?? rede.monthly_interest_percent}
            arredondamento={arred === "" ? rede.rounding_mode : arred}
          />
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={invalido || acimaDoLimite || pendente}
              onClick={() =>
                salvar(
                  {
                    clinicId,
                    lateFeePercent: m,
                    monthlyInterestPercent: j,
                    roundingMode: arred === "" ? null : arred,
                    overduePercent: t,
                  },
                  "Configuração da unidade salva."
                )
              }
            >
              Salvar
            </Button>
            {propria && (
              <Button size="sm" variant="ghost" disabled={pendente} onClick={() => limpar(clinicId)}>
                <RotateCcw className="mr-1 size-3.5" />
                Voltar ao padrão da rede em tudo
              </Button>
            )}
          </div>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Modo leitura. Multa e juros são definidos pela Franqueadora (Admin Master ou Financeiro) — fale com eles se
            precisar de valores diferentes para a sua unidade.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
