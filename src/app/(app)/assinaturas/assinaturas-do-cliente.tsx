import { FileSignature } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isWaiting } from "@/lib/signatures/status";
import { createClient } from "@/lib/supabase/server";
import { EnviarParaAssinaturaDialog } from "./enviar-dialog";
import { ListaDePacotes, PACOTE_DA_LISTA_SELECT, pacotesVisiveis, type PacoteDaLista } from "./lista-de-pacotes";
import { AtualizaAoVivo } from "@/components/assinaturas/atualiza-ao-vivo";

/**
 * O BLOCO "ASSINATURAS DIGITAIS" DA ABA DOCUMENTOS DA FICHA (plano ZS0 §4.7):
 * os pacotes do paciente, a situação de cada um e quem já assinou. Lê pela
 * RLS (quem não pode ver não vê). Desde a ZS4 cada pacote tem as mesmas ações
 * do detalhe (visualizar, baixar, reenviar, cancelar, reenviar como novo),
 * cada uma só para quem pode (`acoesPermitidas`), e o link para o detalhe.
 * A lista em si é a mesma da empresa (`ListaDePacotes`, ZS5).
 */

export async function AssinaturasDoCliente({
  clientId,
  clinicId,
  canSend,
}: {
  clientId: string;
  clinicId: string;
  canSend: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signature_packages")
    .select(PACOTE_DA_LISTA_SELECT)
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<PacoteDaLista[]>();
  const pacotes = pacotesVisiveis(data ?? []);

  return (
    <Card>
      {pacotes.some((p) => isWaiting(p.status)) && <AtualizaAoVivo clientId={clientId} />}
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4 text-gold-tinta" />
            Assinaturas digitais
          </CardTitle>
          {canSend && <EnviarParaAssinaturaDialog clientId={clientId} clinicId={clinicId} origin={{ type: "client", id: clientId }} />}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">Não foi possível ler as assinaturas deste paciente.</p>
        ) : (
          <ListaDePacotes pacotes={pacotes} clientId={clientId} vazio="Nenhum documento enviado para assinatura digital ainda." />
        )}
      </CardContent>
    </Card>
  );
}
