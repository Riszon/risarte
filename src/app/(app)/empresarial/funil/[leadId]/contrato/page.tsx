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
import { Button } from "@/components/ui/button";
import { todayInBrazil } from "@/lib/dates";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDasUnidades,
  rotuloDoBeneficio,
  rotuloDoUso,
} from "@/lib/empresarial/beneficios-da-proposta";
import {
  lerMetas,
  participaDoSocial,
  rotuloDaMeta,
  textoDoPagamento,
} from "@/lib/empresarial/riso-social";
import {
  LINHA_EM_BRANCO,
  lerGenero,
  paragrafosDoBloco,
  preencher,
  trechos,
} from "@/lib/empresarial/contrato";
import { carregarContratoDoLead } from "@/lib/empresarial/contrato-do-lead";
import { AssinaturasDaEmpresa } from "@/app/(app)/assinaturas/assinaturas-da-empresa";
import { BotaoImprimir } from "../botao-imprimir";
import { nomeDoArquivo } from "@/lib/empresarial/documento-da-proposta";
import { DadosDoContrato } from "./dados-do-contrato";
import { PedirPeloWhatsApp } from "../pedir-pelo-whatsapp";
import {
  mensagemDoPedido,
  pendenciasDoPedido,
} from "@/lib/empresarial/pedido-de-informacoes";
import { createClient } from "@/lib/supabase/server";

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
 * onde ele sai. Desde a ZS5 a assinatura digital guarda o PDF enviado e o
 * assinado no pacote (`AssinaturasDaEmpresa`, mesma leitura desta tela).
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

  // A MESMA leitura que vira o PDF de assinatura (ZS5): ver o carregador.
  const carregado = await carregarContratoDoLead(leadId);
  if (!carregado.ok && carregado.motivo === "lead") notFound();
  if (!carregado.ok && carregado.motivo === "modelo") {
    // Sem o modelo não há contrato a mostrar — e a tela diz POR QUÊ, em vez de
    // desenhar um documento vazio com cara de pronto.
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        {voltar}
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          {carregado.erroDoModelo
            ? "Não foi possível ler o modelo de contrato. Ele depende da migração 1027 — confirme se ela foi aplicada neste banco."
            : "Ainda não há modelo de contrato cadastrado para a rede. O gestor do programa cria em Risarte Empresarial → Configurações → Contrato."}
        </p>
      </div>
    );
  }
  if (!carregado.ok) {
    // ⚠️ CONTRATO NÃO SAI COM LEITURA PELA METADE (AP13). Preço, faixas e
    // benefícios que não vieram virariam "preço padrão" e "anexo vazio" num
    // documento que vai para assinatura. Aqui a tela recusa e diz o que não leu.
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        {voltar}
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
          Não foi possível conferir {carregado.motivo === "leitura" ? carregado.naoLido.join(", ") : "o contrato"} desta empresa agora, e
          contrato não se monta com dado pela metade. Recarregue a página; se
          continuar, avise o suporte.
        </p>
      </div>
    );
  }

  const { lead, q, modelos, modelo, contrato, beneficios, nomeDaUnidade, vantagens } = carregado.dados;
  const v = contrato.valores;
  const texto = (t: string) => preencher(t, v);

  // 09/11/2026: pedir à empresa pelo WhatsApp o que falta. A MESMA régua da
  // aba Proposta (com os mesmos pontos de partida: razão social = nome do
  // funil, quem assina = o contato), mais os campos que só o contrato usa.
  const db = await empresarialDb();
  const { data: contato } = await db
    .from("commercial_leads")
    .select("contact_name, contact_phone")
    .eq("id", leadId)
    .maybeSingle<{ contact_name: string | null; contact_phone: string | null }>();
  let consultor: string | null = null;
  if (lead.consultant_id) {
    const { data: p } = await (await createClient())
      .from("profiles")
      .select("full_name, email")
      .eq("id", lead.consultant_id)
      .maybeSingle();
    consultor = p ? p.full_name || p.email : null;
  }
  const pendencias = pendenciasDoPedido({
    employeeCount: q?.employee_count ?? null,
    paymentModel: q?.payment_model ?? null,
    billingBasis: q?.billing_basis ?? null,
    legalName: q?.legal_name ?? lead.company_name,
    responsibleName: q?.responsible_name ?? contato?.contact_name ?? null,
    responsibleCpf: q?.responsible_cpf ?? null,
    responsibleEmail: q?.responsible_email ?? null,
    cnpj: lead.cnpj,
    responsibleRole: q?.responsible_role ?? null,
    address: q?.address ?? null,
    responsibleRg: q?.responsible_rg ?? null,
    responsibleNationality: q?.responsible_nationality ?? null,
    dueDay: q?.due_day ?? null,
  });
  const pedidoDeInformacoes = {
    perguntas: pendencias.daEmpresa,
    nossas: pendencias.nossas,
    telefone: q?.responsible_phone || contato?.contact_phone || null,
    mensagem: mensagemDoPedido({
      contato: q?.responsible_name || contato?.contact_name || null,
      empresa: q?.legal_name || lead.company_name,
      consultor,
      perguntas: pendencias.daEmpresa,
    }),
  };

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
              O sistema não guarda cópia do que for impresso. Pela assinatura
              digital (abaixo), o PDF assinado fica guardado no sistema.
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
                vencimento ficam logo abaixo.
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
              Todos os campos do contrato estão preenchidos.
            </p>
          )}

          {/* Mesmo com o contrato "completo", RG e nacionalidade em branco
              saem como linha para preencher à mão — e podem ser pedidos. */}
          {pedidoDeInformacoes.perguntas.length > 0 && (
            <div>
              <PedirPeloWhatsApp leadId={leadId} pedido={pedidoDeInformacoes} />
            </div>
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

        {/* ZS5: o envio para assinatura digital e os pacotes deste lead. O PDF
            assinado sai da MESMA leitura que desenha o contrato abaixo. */}
        <AssinaturasDaEmpresa
          companyId={lead.company_id}
          leadId={leadId}
          origin={{ type: "commercial_lead", id: leadId }}
        />
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
