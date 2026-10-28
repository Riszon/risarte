import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { todayInBrazil } from "@/lib/dates";
import type { BenefitType } from "@/lib/empresarial/constants";
import type { CompanyCategory } from "@/lib/empresarial/documents";
import type { CompanyAddress } from "@/lib/empresarial/types";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDasUnidades,
  rotuloDoBeneficio,
  rotuloDoUso,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";
import type { PaymentModel } from "@/lib/empresarial/constants";
import { carregarVantagensDaProposta } from "@/lib/empresarial/vantagens-servidor";
import {
  lerMetas,
  participaDoSocial,
  rotuloDaMeta,
  textoDoPagamento,
} from "@/lib/empresarial/riso-social";
import {
  LINHA_EM_BRANCO,
  lerGenero,
  montarContrato,
  paragrafosDoBloco,
  preencher,
  trechos,
} from "@/lib/empresarial/contrato";
import {
  lerContratada,
  lerModelosDoContrato,
} from "@/lib/empresarial/contrato-dados";
import { BotaoImprimir } from "../botao-imprimir";
import { nomeDoArquivo } from "@/lib/empresarial/documento-da-proposta";
import { DadosDoContrato } from "./dados-do-contrato";

/** O título é o nome do arquivo ao salvar em PDF, como na proposta (0.91.0). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>;
}): Promise<Metadata> {
  const { leadId } = await params;
  const db = await empresarialDb();
  const [{ data: lead }, { data: q }] = await Promise.all([
    db.from("commercial_leads").select("company_name").eq("id", leadId).maybeSingle(),
    db.from("lead_qualification").select("legal_name").eq("lead_id", leadId).maybeSingle(),
  ]);
  const empresa = q?.legal_name || lead?.company_name;
  return {
    title: empresa
      ? { absolute: nomeDoArquivo("Contrato", empresa, todayInBrazil()) }
      : "Contrato · Risarte Empresarial",
  };
}

type LeadRow = { id: string; company_name: string; cnpj: string | null };

/**
 * ⚠️ `select("*")` no levantamento, de propósito: as três colunas novas do
 * contrato (RG, nacionalidade, dia de vencimento) nascem com a migração 1027,
 * que viaja à mão. Pedi-las pelo nome derrubaria esta tela — e nomeá-las no
 * tipo como opcionais é o que deixa a tela de pé enquanto a migração não roda.
 */
type QualRow = {
  legal_name: string | null;
  category: CompanyCategory | null;
  address: CompanyAddress | null;
  responsible_name: string | null;
  responsible_role: string | null;
  responsible_cpf: string | null;
  responsible_rg?: string | null;
  responsible_nationality?: string | null;
  due_day?: number | null;
  billing_basis: "PER_EMPLOYEE" | "FIXED_PER_COMPANY" | null;
  fixed_monthly_cents: number | null;
  employee_count: number | null;
  holder_fee_cents: number | null;
  includes_dependents: boolean | null;
  dependent_fee_cents: number | null;
  dependent_mode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependent_family_fee_cents: number | null;
  dependent_family_extra_fee_cents: number | null;
  dependent_family_size: number | null;
  company_grace_days: number | null;
  employee_grace_days: number | null;
  // 1034
  payment_model: PaymentModel | null;
  treatment_payment_methods: string[] | null;
  treatment_max_installments: number | null;
  social_participates: boolean | null;
  social_goals: unknown;
  // 1037: ausentes = a migração ainda não rodou neste banco.
  responsible_gender?: string | null;
  min_term_months?: number | null;
  early_exit_fee_cents?: number | null;
};

type BeneficioRow = {
  procedure_id: string;
  benefit_type: BenefitType;
  benefit_value: number | null;
  usage_limit_count: number | null;
  usage_period_months: number | null;
  grace_period_months: number;
  max_installments: number | null;
  for_holder: boolean;
  for_dependent: boolean;
  clinic_ids: string[] | null;
};

type UnidadeRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

/**
 * O CONTRATO COMO DOCUMENTO (OC-00083, 1027).
 *
 * O texto é o modelo do dono, guardado no banco; a empresa, os valores, o
 * vencimento e as cidades vêm da proposta salva; o Anexo I é a lista de
 * benefícios dela. Ninguém redigita nada — e é a redigitação que faz o
 * contrato dizer um preço e a proposta, outro.
 *
 * ⚠️ O DOCUMENTO NÃO É GUARDADO. Ele é montado na hora, com a data de hoje,
 * como a proposta. O que vale como contrato é o PDF assinado; esta tela é de
 * onde ele sai. (Guardar uma cópia emitida, com código próprio, é o passo
 * seguinte — não está feito, e a tela diz.)
 */
export default async function ContratoPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_name, cnpj")
    .eq("id", leadId)
    .maybeSingle<LeadRow>();
  if (!lead) notFound();

  const voltar = (
    <Button
      variant="ghost"
      size="sm"
      nativeButton={false}
      render={<Link href={`/empresarial/funil/${leadId}`} />}
    >
      ← Voltar à ficha
    </Button>
  );

  const modelos = await lerModelosDoContrato(db, leadId);
  const modelo = modelos.daEmpresa ?? modelos.daRede;
  if (modelos.erro || !modelo) {
    // Sem o modelo não há contrato a mostrar — e a tela diz POR QUÊ, em vez de
    // desenhar um documento vazio com cara de pronto.
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        {voltar}
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          {modelos.erro
            ? "Não foi possível ler o modelo de contrato. Ele depende da migração 1027 — confirme se ela foi aplicada neste banco."
            : "Ainda não há modelo de contrato cadastrado para a rede. O gestor do programa cria em Risarte Empresarial → Configurações → Contrato."}
        </p>
      </div>
    );
  }

  const [
    { data: q, error: erroDoLevantamento },
    { data: faixasRows, error: erroDasFaixas },
    { data: benRows, error: erroDosBeneficios },
    { data: parceriaRows, error: erroDaParceria },
    { contratada, erro: erroDaContratada },
  ] = await Promise.all([
    db
      .from("lead_qualification")
      .select("*")
      .eq("lead_id", leadId)
      .maybeSingle<QualRow>(),
    db
      .from("lead_price_tiers")
      .select("min_quantity, price_cents")
      .eq("lead_id", leadId)
      .returns<{ min_quantity: number; price_cents: number }[]>(),
    db
      .from("lead_benefits")
      .select(
        "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent, clinic_ids"
      )
      .eq("lead_id", leadId)
      .returns<BeneficioRow[]>(),
    db
      .from("lead_clinics")
      .select("clinic_id")
      .eq("lead_id", leadId)
      .returns<{ clinic_id: string }[]>(),
    lerContratada(db),
  ]);
  // 1033: as outras vantagens combinadas — entram no anexo (decisão do dono).
  const vantagens = await carregarVantagensDaProposta(db, leadId);

  // ⚠️ CONTRATO NÃO SAI COM LEITURA PELA METADE (AP13). Preço, faixas e
  // benefícios que não vieram virariam "preço padrão" e "anexo vazio" num
  // documento que vai para assinatura. Aqui a tela recusa e diz o que não leu.
  const naoLido = [
    erroDoLevantamento && "a proposta",
    erroDasFaixas && "as faixas de preço",
    erroDosBeneficios && "os benefícios",
    vantagens === null && "as outras vantagens",
    erroDaParceria && "as unidades da parceria",
    erroDaContratada && "os dados da Risarte",
  ].filter((x): x is string => Boolean(x));

  const supabase = await createClient();
  const idsDaParceria = (parceriaRows ?? []).map((c) => c.clinic_id);
  // Sem parceria declarada, o programa não limita unidade nenhuma (a regra de
  // `valeNaUnidade`): a abrangência é a de todas as unidades ativas da rede.
  const consultaDeUnidades = supabase.from("clinics").select("id, name, city, state");
  const { data: unidadesRows, error: erroDasUnidades } = await (
    idsDaParceria.length > 0
      ? consultaDeUnidades.in("id", idsDaParceria)
      : consultaDeUnidades.eq("is_active", true).eq("type", "franchise_unit")
  ).returns<UnidadeRow[]>();
  if (erroDasUnidades) naoLido.push("as unidades");

  if (naoLido.length > 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        {voltar}
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
          Não foi possível conferir {naoLido.join(", ")} desta empresa agora, e
          contrato não se monta com dado pela metade. Recarregue a página; se
          continuar, avise o suporte.
        </p>
      </div>
    );
  }

  const unidades = unidadesRows ?? [];
  const nomeDaUnidade = new Map(unidades.map((u) => [u.id, u.name]));

  const beneficios: (BeneficioDaProposta & { nome: string })[] = [];
  if (benRows?.length) {
    const { data: procs } = await supabase
      .from("procedures")
      .select("id, name")
      .in("id", benRows.map((b) => b.procedure_id))
      .returns<{ id: string; name: string }[]>();
    const nomePorId = new Map((procs ?? []).map((x) => [x.id, x.name]));
    for (const b of benRows) {
      beneficios.push({
        nome: nomePorId.get(b.procedure_id) ?? "Procedimento",
        procedureId: b.procedure_id,
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        usageLimitCount: b.usage_limit_count,
        usagePeriodMonths: b.usage_period_months,
        gracePeriodMonths: b.grace_period_months,
        maxInstallments: b.max_installments,
        forHolder: b.for_holder,
        forDependent: b.for_dependent,
        clinicIds: b.clinic_ids ?? [],
      });
    }
    beneficios.sort((a, z) => a.nome.localeCompare(z.nome, "pt-BR"));
  }

  const contrato = montarContrato({
    empresa: {
      companyName: lead.company_name,
      cnpj: lead.cnpj,
      legalName: q?.legal_name ?? null,
      category: q?.category ?? null,
      address: q?.address ?? null,
      responsibleName: q?.responsible_name ?? null,
      responsibleRole: q?.responsible_role ?? null,
      responsibleNationality: q?.responsible_nationality ?? null,
      responsibleRg: q?.responsible_rg ?? null,
      responsibleCpf: q?.responsible_cpf ?? null,
      dueDay: q?.due_day ?? null,
      billingBasis: q?.billing_basis ?? null,
      fixedMonthlyCents: q?.fixed_monthly_cents ?? null,
      employeeCount: q?.employee_count ?? null,
      holderFeeCents: q?.holder_fee_cents ?? null,
      includesDependents: q?.includes_dependents ?? null,
      dependentFeeCents: q?.dependent_fee_cents ?? null,
      dependentMode: q?.dependent_mode ?? null,
      dependentFamilyFeeCents: q?.dependent_family_fee_cents ?? null,
      dependentFamilyExtraFeeCents: q?.dependent_family_extra_fee_cents ?? null,
      dependentFamilySize: q?.dependent_family_size ?? null,
      responsibleGender: lerGenero(q?.responsible_gender),
      minTermMonths: q?.min_term_months ?? null,
      earlyExitFeeCents: q?.early_exit_fee_cents ?? null,
    },
    faixas: (faixasRows ?? []).map((f) => ({
      minQuantity: f.min_quantity,
      priceCents: f.price_cents,
    })),
    contratada,
    unidades,
    beneficios: beneficios.length,
    hoje: todayInBrazil(),
  });
  const v = contrato.valores;
  const texto = (t: string) => preencher(t, v);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Some na impressão: o PDF que vai para a empresa não leva botões. */}
      <div className="mb-6 space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {voltar}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/empresarial/funil/${leadId}/contrato/texto`} />}
            >
              {modelos.daEmpresa ? "Editar o texto desta empresa" : "Personalizar o texto"}
            </Button>
            <BotaoImprimir
              tipo="contrato"
              companyName={lead.company_name}
              nomeDoArquivo={nomeDoArquivo(
                "Contrato",
                v.contratante_razao_social || lead.company_name,
                todayInBrazil()
              )}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Antes de enviar</p>
            <p className="text-xs text-muted-foreground">
              O contrato é montado com a proposta SALVA desta empresa e com a
              data de hoje.{" "}
              {modelos.daEmpresa
                ? "O texto foi personalizado para esta empresa."
                : "O texto é o modelo da rede."}{" "}
              O sistema não guarda cópia do que for impresso: o que vale é o
              PDF assinado.
            </p>
          </div>

          {contrato.faltando.length > 0 ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <p className="font-medium">
                Falta preencher — o contrato sai com estas linhas em branco:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {contrato.faltando.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Razão social, CNPJ, quem assina, cargo e CPF ficam no passo 6
                da proposta (<em>Dados do contrato</em>). O endereço, o RG e o
                vencimento ficam logo abaixo.
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
              Todos os campos do contrato estão preenchidos.
            </p>
          )}

          {contrato.avisos.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">
                Leia antes de enviar — onde a proposta não cabe no texto do
                modelo:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {contrato.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <details open={contrato.faltando.some((f) => f.includes("endereço"))}>
            <summary className="cursor-pointer text-sm font-medium">
              Endereço da sede, RG e dia de vencimento
            </summary>
            <div className="pt-3">
              <DadosDoContrato
                leadId={leadId}
                endereco={q?.address ?? null}
                rg={q?.responsible_rg ?? null}
                nacionalidade={q?.responsible_nationality ?? null}
                diaDeVencimento={q?.due_day ?? null}
                genero={
                  q && "responsible_gender" in q ? lerGenero(q.responsible_gender) : undefined
                }
              />
            </div>
          </details>
        </div>
      </div>

      <article className="space-y-4 text-justify text-[13px] leading-relaxed">
        <h1 className="text-center text-sm font-bold uppercase">
          <Texto>{texto(modelo.titulo)}</Texto>
        </h1>

        <p>
          <Texto>{texto(modelo.preambulo)}</Texto>
        </p>

        {modelo.blocos.map((b, i) => (
          <section key={i} className="space-y-2">
            {paragrafosDoBloco(b).map((p, j) => (
              <p key={j}>
                {p.rotulo && <strong>{p.rotulo} </strong>}
                <Texto>{texto(p.texto)}</Texto>
              </p>
            ))}
          </section>
        ))}

        {modelo.fecho.trim() && (
          <p>
            <Texto>{texto(modelo.fecho)}</Texto>
          </p>
        )}

        <p>
          {v.cidade_assinatura ?? LINHA_EM_BRANCO}, {v.data_assinatura ?? LINHA_EM_BRANCO}.
        </p>

        <div className="space-y-10 pt-8 text-center break-inside-avoid">
          <Assinatura
            linhas={[
              v.contratante_razao_social ?? LINHA_EM_BRANCO,
              v.contratante_representante ?? LINHA_EM_BRANCO,
              "CONTRATANTE",
            ]}
          />
          <Assinatura
            linhas={[
              v.contratada_razao_social ?? LINHA_EM_BRANCO,
              `Rep. ${v.contratada_representante ?? LINHA_EM_BRANCO}`,
              "CONTRATADO",
            ]}
          />
          <div className="grid grid-cols-2 gap-8">
            <Assinatura linhas={["TESTEMUNHA 01"]} />
            <Assinatura linhas={["TESTEMUNHA 02"]} />
          </div>
        </div>

        {/* O ANEXO I — citado nas cláusulas oitava, nona e décima. Decisão do
            dono (13/10/2026): ele é a lista de benefícios DESTA proposta, e
            não um texto fixo. Sempre igual ao que foi vendido. */}
        <section className="space-y-3 pt-8 break-before-page">
          <h2 className="text-center text-sm font-bold uppercase">
            Anexo I — Rol de procedimentos, cobertura e carências
          </h2>
          <p>
            Procedimentos, cobertura, limite de uso e carência combinados na
            proposta comercial desta parceria.
          </p>
          {(q?.company_grace_days ?? 0) > 0 || (q?.employee_grace_days ?? 0) > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {(q?.company_grace_days ?? 0) > 0 && (
                <li>
                  Carência do programa: {q!.company_grace_days} dia(s), contados
                  do início do contrato.
                </li>
              )}
              {(q?.employee_grace_days ?? 0) > 0 && (
                <li>
                  Carência de cada titular: {q!.employee_grace_days} dia(s),
                  contados da entrada dele no programa.
                </li>
              )}
            </ul>
          ) : null}

          {beneficios.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-left">
              Nenhum procedimento foi combinado na proposta desta empresa.
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="py-1.5 pr-2 font-semibold">Procedimento</th>
                  <th className="py-1.5 pr-2 font-semibold">Cobertura</th>
                  <th className="py-1.5 pr-2 font-semibold">Para quem</th>
                  <th className="py-1.5 pr-2 font-semibold">Limite de uso</th>
                  <th className="py-1.5 font-semibold">Carência</th>
                </tr>
              </thead>
              <tbody>
                {beneficios.map((b) => (
                  <tr key={b.procedureId} className="border-b align-top">
                    <td className="py-1.5 pr-2">
                      {b.nome}
                      {b.clinicIds?.length ? (
                        <span className="block text-muted-foreground">
                          {rotuloDasUnidades(b.clinicIds, nomeDaUnidade)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2">{rotuloDoBeneficio(b)}</td>
                    <td className="py-1.5 pr-2">{paraQuemVale(b)}</td>
                    <td className="py-1.5 pr-2">{rotuloDoUso(b) ?? "sem limite"}</td>
                    <td className="py-1.5">{rotuloDaCarencia(b) ?? "sem carência"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 1034: o pagamento do tratamento e o Riso+ Social combinados. */}
          <div className="space-y-1 text-left">
            <p className="font-semibold">Pagamento do tratamento</p>
            <p>
              {textoDoPagamento(q?.treatment_payment_methods, q?.treatment_max_installments)},
              somado às condições da unidade.
            </p>
          </div>
          {participaDoSocial(q?.payment_model) && q?.social_participates !== false && (
            <div className="space-y-1 text-left">
              <p className="font-semibold">Riso+ Social</p>
              <p>
                Enquanto pagar, integral ou parcialmente, a mensalidade dos
                Titulares, a CONTRATANTE poderá indicar pessoas carentes
                para tratamento
                {lerMetas(q?.social_goals).length > 0
                  ? ", conforme as metas abaixo (em cada uma, todas as condições ao mesmo tempo):"
                  : ", em quantidade combinada com a CONTRATADA."}
              </p>
              {lerMetas(q?.social_goals).length > 0 && (
                <ol className="list-decimal space-y-0.5 pl-5">
                  {lerMetas(q?.social_goals).map((m) => (
                    <li key={m.id}>{rotuloDaMeta(m)}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {(vantagens ?? []).length > 0 && (
            <div className="space-y-1 text-left">
              <p className="font-semibold">Outras vantagens</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {(vantagens ?? []).map((v) => (
                  <li key={v.perkId}>{v.texto}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </article>
    </div>
  );
}

/** Texto do modelo, com `**negrito**` desenhado. */
function Texto({ children }: { children: string }) {
  return (
    <>
      {trechos(children).map((t, i) =>
        t.negrito ? <strong key={i}>{t.texto}</strong> : <span key={i}>{t.texto}</span>
      )}
    </>
  );
}

function Assinatura({ linhas }: { linhas: string[] }) {
  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-1 border-t border-foreground" />
      {linhas.map((l, i) => (
        <p key={i} className="font-semibold">
          {l}
        </p>
      ))}
    </div>
  );
}
