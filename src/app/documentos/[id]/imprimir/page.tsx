import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/documents";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Documento" };

type DocRow = {
  id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  created_at: string;
  clients: { full_name: string; cpf: string | null } | null;
  clinics: { name: string } | null;
  author: { full_name: string } | { full_name: string }[] | null;
};

export default async function DocumentPrintPage(
  props: PageProps<"/documentos/[id]/imprimir">
) {
  await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("clinical_documents")
    .select(
      "id, kind, title, body, created_at, clients ( full_name, cpf ), clinics ( name ), author:profiles!clinical_documents_author_id_fkey ( full_name )"
    )
    .eq("id", id)
    .single<DocRow>();

  if (!doc) notFound();

  const authorRaw = doc.author;
  const authorName =
    (Array.isArray(authorRaw) ? authorRaw[0] : authorRaw)?.full_name ?? null;
  const dateStr = new Date(doc.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-[210mm] px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="javascript:history.back()" className="text-sm underline">
          ← Voltar
        </a>
        <PrintButton />
      </div>

      <div className="rounded-md border bg-white p-8 print:border-0 print:p-0">
        {/* Cabeçalho da unidade */}
        <div className="mb-6 border-b pb-3 text-center">
          <p className="text-lg font-semibold">
            {doc.clinics?.name ?? "Risarte Odontologia"}
          </p>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {DOCUMENT_KIND_LABELS[doc.kind]}
          </p>
        </div>

        {/* Paciente */}
        <p className="mb-4">
          <span className="text-gray-500">Paciente: </span>
          <span className="font-medium">{doc.clients?.full_name ?? "—"}</span>
          {doc.clients?.cpf ? (
            <span className="text-gray-500"> · CPF {doc.clients.cpf}</span>
          ) : null}
        </p>

        {/* Título + corpo */}
        <h1 className="mb-2 text-base font-semibold">{doc.title}</h1>
        <div className="whitespace-pre-wrap leading-relaxed">{doc.body}</div>

        {/* Data + assinatura */}
        <div className="mt-12 text-center">
          <p className="mb-10">
            {doc.clinics?.name ? `${doc.clinics.name}, ` : ""}
            {dateStr}
          </p>
          <div className="mx-auto w-64 border-t pt-1">
            <p className="text-sm">{authorName ?? "Profissional responsável"}</p>
            <p className="text-xs text-gray-500">Cirurgião(ã)-Dentista</p>
          </div>
        </div>
      </div>
    </div>
  );
}
