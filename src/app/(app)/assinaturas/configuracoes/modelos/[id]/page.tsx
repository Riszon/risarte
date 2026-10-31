import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import { canConfigureSignatures } from "@/lib/signatures/access";
import type { SignatureTemplate } from "@/lib/signatures/types";
import { corpoValido } from "@/lib/signatures/variables";
import { createClient } from "@/lib/supabase/server";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Assinaturas — Editar modelo" };
export const dynamic = "force-dynamic";

export default async function EditarModeloPage(props: PageProps<"/assinaturas/configuracoes/modelos/[id]">) {
  const session = await getSessionContext();
  if (!canConfigureSignatures(session)) redirect("/assinaturas");
  const { id } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("signature_templates")
    .select("id, code, name, audience, kind, body, source, variables, auth_level, witness_count, witness_mode, default_witness_staff_ids, risarte_signer_mode, risarte_signer_role, risarte_signer_user_id, is_active, is_provisional_text, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const template: SignatureTemplate = {
    ...data,
    body: corpoValido(data.body) ? data.body : null,
    variables: data.variables ?? [],
    default_witness_staff_ids: data.default_witness_staff_ids ?? [],
  } as SignatureTemplate;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileText}
        titulo={template.name}
        descricao="Escreva o texto como vai sair no PDF. Os campos entre chaves duplas são preenchidos pelo sistema na hora do envio; campo que o sistema não conhece não pode ser salvo."
        voltar={{ href: "/assinaturas/configuracoes/modelos", rotulo: "Modelos" }}
      />
      <TemplateForm template={template} />
    </div>
  );
}
