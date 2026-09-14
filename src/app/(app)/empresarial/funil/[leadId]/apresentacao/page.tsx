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
import { BotaoImprimir } from "./botao-imprimir";

export const metadata: Metadata = {
  title: "Apresentação · Risarte Empresarial",
};

type TemplateRow = {
  lead_id: string | null;
  title: string;
  subtitle: string | null;
  sections: { titulo: string; corpo: string }[];
};

export default async function ApresentacaoPage({
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
    .select("id, company_name")
    .eq("id", leadId)
    .maybeSingle<{ id: string; company_name: string }>();
  if (!lead) notFound();

  // A cascata: a apresentação desta empresa, senão o padrão da rede.
  const { data: rows, error } = await db
    .from("presentation_templates")
    .select("lead_id, title, subtitle, sections")
    .or(`lead_id.eq.${leadId},lead_id.is.null`)
    .returns<TemplateRow[]>();
  if (error) {
    console.error("apresentação:", error.message);
    throw new Error(
      "Não foi possível ler a apresentação. Confirme se a migração 1010 foi aplicada neste banco."
    );
  }
  const template =
    rows?.find((r) => r.lead_id === leadId) ?? rows?.find((r) => !r.lead_id);

  // Régua vazia grita: sem padrão da rede E sem personalização, o problema é a
  // semente da migração não ter entrado — dizer isso é melhor que uma página
  // em branco com cara de apresentação vazia.
  if (!template) {
    throw new Error(
      "Não há apresentação padrão cadastrada. A semente da migração 1010 não entrou neste banco."
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Some na impressão: o PDF que vai para a empresa não leva botões. */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/empresarial/funil/${leadId}`} />}
        >
          ← Voltar ao levantamento
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {template.lead_id
              ? "Apresentação desta empresa"
              : "Padrão da rede"}
          </span>
          <BotaoImprimir companyName={lead.company_name} />
        </div>
      </div>

      <article className="space-y-8">
        <header className="space-y-1 border-b pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            {template.title}
          </h1>
          {template.subtitle && (
            <p className="text-lg text-muted-foreground">{template.subtitle}</p>
          )}
          <p className="pt-3 text-sm text-muted-foreground">
            Preparado para <strong>{lead.company_name}</strong>
          </p>
        </header>

        {template.sections.map((s, i) => (
          <section key={i} className="space-y-1.5 break-inside-avoid">
            {s.titulo && (
              <h2 className="text-lg font-medium">{s.titulo}</h2>
            )}
            {s.corpo && (
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {s.corpo}
              </p>
            )}
          </section>
        ))}

        <footer className="border-t pt-6 text-sm text-muted-foreground">
          Risarte Odontologia · Risarte Empresarial
        </footer>
      </article>
    </div>
  );
}
