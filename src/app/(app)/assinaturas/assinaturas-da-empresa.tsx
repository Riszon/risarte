import { FileSignature } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import { canSendSignatures } from "@/lib/signatures/access";
import { clinicaEmissoraDaEmpresa } from "@/lib/signatures/send-empresa";
import { isWaiting } from "@/lib/signatures/status";
import { createClient } from "@/lib/supabase/server";
import { AtualizaAoVivo } from "@/components/assinaturas/atualiza-ao-vivo";
import { EnviarEmpresaParaAssinaturaDialog } from "./enviar-empresa-dialog";
import { ListaDePacotes, PACOTE_DA_LISTA_SELECT, pacotesVisiveis, type PacoteDaLista } from "./lista-de-pacotes";

/**
 * O BLOCO "ASSINATURAS DIGITAIS" DO EMPRESARIAL (ZS5, plano ZS0 §4.6): na
 * tela do contrato do funil (pacotes do LEAD) e na ficha da empresa (pacotes
 * da EMPRESA e, se ela veio do funil, os do lead de origem — o pacote
 * assinado não muda depois de criado, então a empresa o acha pelo lead).
 *
 * A RLS recorta: o Consultor RisLife só vê os pacotes das empresas e dos
 * leads em que é o responsável (0340).
 */

export function podeEnviarPelaEmpresa(session: Awaited<ReturnType<typeof getSessionContext>>): boolean {
  if (!isProgramManager(session) && !isRislifeConsultant(session)) return false;
  const clinica = clinicaEmissoraDaEmpresa(session);
  return !!clinica && canSendSignatures(session, clinica.id);
}

export async function AssinaturasDaEmpresa({
  companyId,
  leadId,
  origin,
  titulo = "Assinaturas digitais",
  mostrarEnvio = true,
}: {
  companyId: string | null;
  leadId: string | null;
  /** De onde sai o envio por este bloco. */
  origin: { type: "commercial_lead" | "company"; id: string };
  titulo?: string;
  mostrarEnvio?: boolean;
}) {
  const session = await getSessionContext();
  const supabase = await createClient();
  const filtros = [companyId ? `company_id.eq.${companyId}` : null, leadId ? `lead_id.eq.${leadId}` : null].filter(Boolean).join(",");
  const { data, error } = filtros
    ? await supabase
        .from("signature_packages")
        .select(PACOTE_DA_LISTA_SELECT)
        .eq("audience", "company")
        .or(filtros)
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<PacoteDaLista[]>()
    : { data: [] as PacoteDaLista[], error: null };
  const pacotes = pacotesVisiveis(data ?? []);

  return (
    <Card className="print:hidden">
      {pacotes.some((p) => isWaiting(p.status)) && <AtualizaAoVivo />}
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4 text-gold-tinta" />
            {titulo}
          </CardTitle>
          {mostrarEnvio && podeEnviarPelaEmpresa(session) && <EnviarEmpresaParaAssinaturaDialog origin={origin} />}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">Não foi possível ler as assinaturas desta empresa.</p>
        ) : (
          <ListaDePacotes pacotes={pacotes} clientId={null} vazio="Nenhum documento desta empresa foi enviado para assinatura digital ainda." />
        )}
      </CardContent>
    </Card>
  );
}
