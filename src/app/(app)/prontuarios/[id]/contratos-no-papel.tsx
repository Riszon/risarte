import { FileSignature } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatBrDate } from "@/lib/dates";
import { VerPapelDoContrato } from "../../apresentacao/[clientId]/papel-do-contrato";

/**
 * OC-00171 (0392): os contratos assinados NO PAPEL do cliente, na aba
 * Documentos — o papel que o consultor anexou ao marcar o contrato à mão.
 * Lê pela regra das tabelas (quem não vê a venda não vê a linha) e cala sem a
 * 0392 no banco.
 */
export async function ContratosNoPapel({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commercial_sales")
    .select("negotiation_id, contract_paper_name, contract_paper_at")
    .eq("client_id", clientId)
    .not("contract_paper_path", "is", null)
    .order("contract_paper_at", { ascending: false })
    .returns<{ negotiation_id: string; contract_paper_name: string | null; contract_paper_at: string | null }[]>();
  if (error || !data || data.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <FileSignature className="size-4" />
        Contratos assinados no papel
      </h3>
      <ul className="space-y-1.5">
        {data.map((c) => (
          <li key={c.negotiation_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Anexado {c.contract_paper_at ? `em ${formatBrDate(c.contract_paper_at)}` : ""}
            </span>
            <VerPapelDoContrato negotiationId={c.negotiation_id} nome={c.contract_paper_name} />
          </li>
        ))}
      </ul>
    </div>
  );
}
