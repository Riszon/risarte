"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_DOCS_BUCKET } from "@/lib/empresarial/documents";
import {
  IMPLANTACAO_SITUACAO_LABELS,
  IMPLANTACAO_SITUACOES,
  type TermosDoContrato,
} from "@/lib/empresarial/revisao-do-contrato";
import { OpenFileButton } from "../../documentos-tab";
import { anexarAditivo, aplicarRevisao, cancelarRevisao, salvarRevisao } from "../../revisao-actions";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-70";

const reais = (c: number | null | undefined) =>
  c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: number | null | undefined) => (v == null ? "" : String(v));

function Campo({ id, label, children, dica }: { id: string; label: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

export function RevisaoDoContrato({
  revisaoId,
  companyId,
  rascunho,
  motivo,
  termos,
  temMudancas,
  aditivo,
  podeAplicar,
}: {
  revisaoId: string;
  companyId: string;
  rascunho: boolean;
  motivo: string;
  termos: TermosDoContrato;
  temMudancas: boolean;
  aditivo: { nome: string; caminho: string } | null;
  podeAplicar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [erros, setErros] = useState<string[]>([]);
  const e = termos.empresa;
  const [modelo, setModelo] = useState(e.payment_model);
  const [base, setBase] = useState(e.billing_basis ?? "PER_EMPLOYEE");
  const [excesso, setExcesso] = useState(e.excess_mode ?? "");
  const [origemDoPreco, setOrigemDoPreco] = useState<"rede" | "proprio">(termos.preco ? "proprio" : "rede");
  const [situacao, setSituacao] = useState(e.implantation_status ?? "COBRAR");
  const [faixas, setFaixas] = useState(
    termos.faixas.length ? termos.faixas.map((f) => ({ q: String(f.min_quantity), p: reais(f.price_cents) })) : [{ q: "", p: "" }]
  );
  const p = termos.preco;

  function salvar(form: HTMLFormElement) {
    const fd = new FormData(form);
    startTransition(async () => {
      const r = await salvarRevisao(revisaoId, fd);
      if (r.ok) {
        setErros([]);
        toast.success("Revisão salva. Confira o que muda no alto da página.");
        router.refresh();
      } else {
        setErros(r.erros ?? [r.error ?? "Erro."]);
        toast.error(r.error ?? "Erro.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          salvar(ev.currentTarget);
        }}
        className="space-y-4"
      >
        <fieldset disabled={!rascunho || isPending} className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Motivo da revisão</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                name="reason"
                defaultValue={motivo}
                required
                minLength={10}
                rows={2}
                className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-70"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preço</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="billing_basis" label="Como se cobra">
                  <select id="billing_basis" name="billing_basis" value={base} onChange={(x) => setBase(x.target.value)} className={SELECT}>
                    <option value="PER_EMPLOYEE">Por titular</option>
                    <option value="FIXED_PER_COMPANY">Valor fixo por empresa</option>
                  </select>
                </Campo>
                {base === "FIXED_PER_COMPANY" && (
                  <Campo id="fixed_monthly_cents" label="Valor fixo mensal (R$)">
                    <Input id="fixed_monthly_cents" name="fixed_monthly_cents" inputMode="decimal" defaultValue={reais(e.fixed_monthly_cents)} />
                  </Campo>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="preco_origem" value="rede" checked={origemDoPreco === "rede"} onChange={() => setOrigemDoPreco("rede")} />
                  Preço da rede
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preco_origem" value="proprio" checked={origemDoPreco === "proprio"} onChange={() => setOrigemDoPreco("proprio")} />
                  Preço próprio desta empresa
                </label>
              </div>
              {origemDoPreco === "proprio" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo id="holder_fee_cents" label="Por titular (R$)">
                    <Input id="holder_fee_cents" name="holder_fee_cents" inputMode="decimal" defaultValue={reais(p?.holder_fee_cents)} />
                  </Campo>
                  <Campo id="dependent_mode" label="Dependentes">
                    <select id="dependent_mode" name="dependent_mode" defaultValue={p?.dependent_mode ?? "FAMILY_PACKAGE"} className={SELECT}>
                      <option value="FAMILY_PACKAGE">Plano familiar</option>
                      <option value="PER_DEPENDENT">Por dependente</option>
                    </select>
                  </Campo>
                  <Campo id="dependent_individual_fee_cents" label="1 dependente (R$)">
                    <Input id="dependent_individual_fee_cents" name="dependent_individual_fee_cents" inputMode="decimal" defaultValue={reais(p?.dependent_individual_fee_cents)} />
                  </Campo>
                  <Campo id="dependent_family_fee_cents" label="Pacote familiar (R$)">
                    <Input id="dependent_family_fee_cents" name="dependent_family_fee_cents" inputMode="decimal" defaultValue={reais(p?.dependent_family_fee_cents)} />
                  </Campo>
                  <Campo id="dependent_family_size" label="Pacote de até (dependentes)">
                    <Input id="dependent_family_size" name="dependent_family_size" inputMode="numeric" defaultValue={num(p?.dependent_family_size ?? 3)} />
                  </Campo>
                  <Campo id="dependent_family_extra_fee_cents" label="Cada extra (R$)">
                    <Input id="dependent_family_extra_fee_cents" name="dependent_family_extra_fee_cents" inputMode="decimal" defaultValue={reais(p?.dependent_family_extra_fee_cents)} />
                  </Campo>
                  <Campo id="max_installments" label="Adesão em até (parcelas)">
                    <Input id="max_installments" name="max_installments" inputMode="numeric" defaultValue={num(p?.max_installments ?? 24)} />
                  </Campo>
                </div>
              )}
              {base !== "FIXED_PER_COMPANY" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Faixas por quantidade</p>
                  {faixas.map((f, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>A partir de</span>
                      <Input name="faixa_min" aria-label={`Faixa ${i + 1}: a partir de`} className="w-20" inputMode="numeric" defaultValue={f.q} />
                      <span>titulares: R$</span>
                      <Input name="faixa_preco" aria-label={`Faixa ${i + 1}: preço`} className="w-28" inputMode="decimal" defaultValue={f.p} />
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setFaixas([...faixas, { q: "", p: "" }])}>
                    + Faixa
                  </Button>
                  <p className="text-xs text-muted-foreground">Deixe a linha em branco para tirar a faixa.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quantidade contratada</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Campo id="contracted_holders" label="Titulares contratados">
                <Input id="contracted_holders" name="contracted_holders" inputMode="numeric" defaultValue={num(e.contracted_holders)} />
              </Campo>
              <Campo id="contracted_dependents" label="Dependentes contratados">
                <Input id="contracted_dependents" name="contracted_dependents" inputMode="numeric" defaultValue={num(e.contracted_dependents)} />
              </Campo>
              <div />
              <Campo id="min_adhesions" label="Mínimo de adesões">
                <Input id="min_adhesions" name="min_adhesions" inputMode="numeric" defaultValue={num(e.min_adhesions)} />
              </Campo>
              <Campo id="max_adhesions" label="Máximo de adesões">
                <Input id="max_adhesions" name="max_adhesions" inputMode="numeric" defaultValue={num(e.max_adhesions)} />
              </Campo>
              <Campo id="adhesion_limit_target" label="Os limites contam">
                <select id="adhesion_limit_target" name="adhesion_limit_target" defaultValue={e.adhesion_limit_target ?? "HOLDERS"} className={SELECT}>
                  <option value="HOLDERS">Titulares</option>
                  <option value="DEPENDENTS">Dependentes</option>
                  <option value="BOTH">Titulares e dependentes</option>
                </select>
              </Campo>
              {base === "FIXED_PER_COMPANY" && (
                <>
                  <Campo id="excess_mode" label="Acima do contratado">
                    <select id="excess_mode" name="excess_mode" value={excesso} onChange={(x) => setExcesso(x.target.value)} className={SELECT}>
                      <option value="">Não combinado</option>
                      <option value="NEW_FIXED">Novo valor fixo</option>
                      <option value="PER_ADHESION">Por adesão</option>
                    </select>
                  </Campo>
                  {excesso === "NEW_FIXED" && (
                    <Campo id="excess_fixed_cents" label="Novo valor fixo (R$)">
                      <Input id="excess_fixed_cents" name="excess_fixed_cents" inputMode="decimal" defaultValue={reais(e.excess_fixed_cents)} />
                    </Campo>
                  )}
                  {excesso === "PER_ADHESION" && (
                    <>
                      <Campo id="excess_holder_fee_cents" label="Por titular a mais (R$)">
                        <Input id="excess_holder_fee_cents" name="excess_holder_fee_cents" inputMode="decimal" defaultValue={reais(e.excess_holder_fee_cents)} />
                      </Campo>
                      <Campo id="excess_dependent_fee_cents" label="Por dependente a mais (R$)">
                        <Input id="excess_dependent_fee_cents" name="excess_dependent_fee_cents" inputMode="decimal" defaultValue={reais(e.excess_dependent_fee_cents)} />
                      </Campo>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Implantação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <fieldset className="space-y-1.5">
                {IMPLANTACAO_SITUACOES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="implantation_status" value={s} checked={situacao === s} onChange={() => setSituacao(s)} />
                    {IMPLANTACAO_SITUACAO_LABELS[s]}
                  </label>
                ))}
              </fieldset>
              {situacao === "JA_PAGA" && (
                <Campo
                  id="implantation_prepaid_holders"
                  label="Quantos titulares já pagaram a implantação"
                  dica="O Gerar implantação passa a cobrar só os titulares além deste número. Os dependentes de hoje contam como já pagos."
                >
                  <Input id="implantation_prepaid_holders" name="implantation_prepaid_holders" inputMode="numeric" className="w-32" defaultValue={num(e.implantation_prepaid_holders)} />
                </Campo>
              )}
              {situacao === "ISENTA" && (
                <p className="text-xs text-muted-foreground">O Gerar implantação deixa de cobrar esta empresa.</p>
              )}
              <Campo id="implantation_includes_dependents" label="A implantação cobra os dependentes?">
                <select
                  id="implantation_includes_dependents"
                  name="implantation_includes_dependents"
                  defaultValue={e.implantation_includes_dependents ? "sim" : "nao"}
                  className={`${SELECT} max-w-xs`}
                >
                  <option value="nao">Não, só os titulares</option>
                  <option value="sim">Sim, titulares e dependentes</option>
                </select>
              </Campo>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cobrança, carências e contrato</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Campo id="payment_model" label="Quem paga">
                <select id="payment_model" name="payment_model" value={modelo} onChange={(x) => setModelo(x.target.value)} className={SELECT}>
                  <option value="COMPANY_PAYS">Empresa paga integral</option>
                  <option value="COMPANY_PARTIAL">Empresa paga parcial</option>
                  <option value="EMPLOYEE_PAYS">Titular paga</option>
                </select>
              </Campo>
              {modelo === "COMPANY_PARTIAL" && (
                <>
                  <Campo id="company_subsidy_type" label="Subsídio em">
                    <select id="company_subsidy_type" name="company_subsidy_type" defaultValue={e.company_subsidy_type ?? "PERCENT"} className={SELECT}>
                      <option value="PERCENT">Percentual (%)</option>
                      <option value="AMOUNT">Valor (R$)</option>
                    </select>
                  </Campo>
                  <Campo id="company_subsidy_value" label="Quanto a empresa paga">
                    <Input
                      id="company_subsidy_value"
                      name="company_subsidy_value"
                      inputMode="decimal"
                      defaultValue={e.company_subsidy_type === "AMOUNT" ? reais(e.company_subsidy_value) : num(e.company_subsidy_value)}
                    />
                  </Campo>
                </>
              )}
              <Campo id="due_day" label="Dia de vencimento">
                <Input id="due_day" name="due_day" inputMode="numeric" defaultValue={num(e.due_day)} />
              </Campo>
              <Campo id="default_max_installments" label="Tratamento em até (parcelas)">
                <Input id="default_max_installments" name="default_max_installments" inputMode="numeric" defaultValue={num(e.default_max_installments)} />
              </Campo>
              <div className="space-y-1">
                <p className="text-sm font-medium">Formas de pagamento do tratamento</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {[
                    ["BOLETO", "Boleto"],
                    ["PIX", "Pix"],
                    ["CARD", "Cartão"],
                  ].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1.5">
                      <input type="checkbox" name="payment_methods" value={v} defaultChecked={(e.payment_methods ?? []).includes(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <Campo id="grace_period_days" label="Carência da empresa (dias)">
                <Input id="grace_period_days" name="grace_period_days" inputMode="numeric" defaultValue={num(e.grace_period_days)} />
              </Campo>
              <Campo id="employee_grace_period_days" label="Carência do colaborador (dias)">
                <Input id="employee_grace_period_days" name="employee_grace_period_days" inputMode="numeric" defaultValue={num(e.employee_grace_period_days)} />
              </Campo>
              <div />
              <Campo id="min_term_months" label="Prazo mínimo (meses)">
                <Input id="min_term_months" name="min_term_months" inputMode="numeric" defaultValue={num(e.min_term_months)} />
              </Campo>
              <Campo id="early_exit_fee_cents" label="Multa de saída antecipada (R$)">
                <Input id="early_exit_fee_cents" name="early_exit_fee_cents" inputMode="decimal" defaultValue={reais(e.early_exit_fee_cents)} />
              </Campo>
              <div className="sm:col-span-3">
                <Campo id="special_agreements" label="Combinado na venda">
                  <textarea
                    id="special_agreements"
                    name="special_agreements"
                    defaultValue={e.special_agreements ?? ""}
                    rows={2}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-70"
                  />
                </Campo>
              </div>
            </CardContent>
          </Card>
        </fieldset>

        {erros.length > 0 && (
          <ul className="list-disc rounded-md border border-red-300 bg-red-50 p-3 pl-6 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {erros.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {rascunho && (
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar a revisão"}
          </Button>
        )}
      </form>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aditivo assinado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {aditivo ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>{aditivo.nome}</span>
              <OpenFileButton kind="company" path={aditivo.caminho} />
            </div>
          ) : (
            <p className="text-muted-foreground">
              Nenhum anexado. A revisão só vale com o aditivo (ou o contrato novo) assinado pela empresa.
            </p>
          )}
          {rascunho && <EnviarAditivo revisaoId={revisaoId} companyId={companyId} trocar={Boolean(aditivo)} />}
        </CardContent>
      </Card>

      {rascunho && (
        <div className="flex flex-wrap items-center gap-2">
          {podeAplicar ? (
            <AplicarRevisao revisaoId={revisaoId} pronta={Boolean(aditivo) && temMudancas} companyId={companyId} />
          ) : (
            <p className="text-sm text-muted-foreground">Quem aplica a revisão é o gestor do programa.</p>
          )}
          <CancelarRevisao revisaoId={revisaoId} companyId={companyId} />
        </div>
      )}
    </div>
  );
}

function EnviarAditivo({ revisaoId, companyId, trocar }: { revisaoId: string; companyId: string; trocar: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function enviar(file: File) {
    setEnviando(true);
    const supabase = createClient();
    const nome = file.name.replace(/[^\w.\-]/g, "_").slice(0, 120);
    const caminho = `${companyId}/${Date.now()}-${nome}`;
    const { error } = await supabase.storage.from(COMPANY_DOCS_BUCKET).upload(caminho, file, { contentType: file.type });
    if (error) {
      setEnviando(false);
      toast.error("Não foi possível enviar o arquivo.");
      return;
    }
    const r = await anexarAditivo(revisaoId, file.name, caminho);
    setEnviando(false);
    if (ref.current) ref.current.value = "";
    if (r.ok) {
      toast.success("Aditivo anexado. Ele também fica na aba Documentos.");
      router.refresh();
    } else toast.error(r.error ?? "Erro.");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        className="text-sm"
        aria-label={trocar ? "Trocar o aditivo" : "Anexar o aditivo assinado"}
        disabled={enviando}
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) void enviar(f);
        }}
      />
      {enviando && <span className="text-xs text-muted-foreground">Enviando...</span>}
    </div>
  );
}

function AplicarRevisao({ revisaoId, pronta, companyId }: { revisaoId: string; pronta: boolean; companyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      disabled={!pronta || isPending}
      title={pronta ? undefined : "Precisa de pelo menos uma mudança salva e do aditivo anexado."}
      onClick={() => {
        if (!window.confirm("Aplicar a revisão? As regras novas valem a partir da próxima cobrança gerada; o que já foi gerado não muda.")) return;
        startTransition(async () => {
          const r = await aplicarRevisao(revisaoId);
          if (r.ok) {
            toast.success("Revisão aplicada. As regras novas já valem.");
            router.push(`/empresarial/${companyId}?aba=regras`);
          } else toast.error(r.error ?? "Erro.");
        });
      }}
    >
      {isPending ? "Aplicando..." : "Aplicar a revisão"}
    </Button>
  );
}

function CancelarRevisao({ revisaoId, companyId }: { revisaoId: string; companyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() => {
        const motivo = window.prompt("Por que cancelar esta revisão? (pelo menos 10 letras)");
        if (!motivo) return;
        startTransition(async () => {
          const r = await cancelarRevisao(revisaoId, motivo);
          if (r.ok) {
            toast.success("Revisão cancelada. Nada mudou na empresa.");
            router.push(`/empresarial/${companyId}?aba=regras`);
          } else toast.error(r.error ?? "Erro.");
        });
      }}
    >
      Cancelar a revisão
    </Button>
  );
}
