import { BellOff, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BotoesDosAvisos } from "./avisos-de-cobranca-botoes";

/**
 * ASA2, entrega 3 (4007) — os avisos de cobrança do Asaas para o pagador deste
 * paciente (o responsável financeiro, quando houver). Só aparece para quem pode
 * desligar (o banco devolve vazio para os outros). Banco sem a 4007: nada.
 */
type Status = {
  payer_name: string | null;
  payer_kind: "client" | "guardian" | null;
  has_payer: boolean;
  opted_out: boolean;
  reason: string | null;
  created_at: string | null;
  created_by_name: string | null;
  reactivated_at: string | null;
  reactivated_by_name: string | null;
  can_disable: boolean;
  can_enable: boolean;
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

export async function AvisosDeCobranca({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_optout_status", { p_client_id: clientId });
  if (error) return null;
  const s = (Array.isArray(data) ? data[0] : data) as Status | null;
  if (!s || !s.has_payer) return null;
  const quem = s.payer_kind === "guardian" ? `o responsável financeiro (${s.payer_name ?? "—"})` : "o paciente";

  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex gap-2">
        {s.opted_out ? (
          <BellOff className="mt-0.5 size-4 shrink-0 text-amber-600" />
        ) : (
          <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div>
          <div className="font-medium">
            {s.opted_out ? "Não recebe avisos de cobrança do Asaas" : "Avisos de cobrança do Asaas"}
          </div>
          <div className="text-xs text-muted-foreground">
            {s.opted_out ? (
              <>
                Pedido registrado por {s.created_by_name ?? "—"} em {quando(s.created_at)}: “{s.reason}”. Vale para{" "}
                {quem} em todas as unidades. O comprovante continua disponível aqui para a clínica enviar.
              </>
            ) : (
              <>
                Quem recebe é {quem}, quando a régua da unidade está ligada. Se ele pedir para não receber, registre aqui —
                vale em todas as unidades.
                {s.reactivated_at && ` Voltou a receber em ${quando(s.reactivated_at)} (${s.reactivated_by_name ?? "—"}).`}
              </>
            )}
          </div>
        </div>
      </div>
      <BotoesDosAvisos clientId={clientId} naoRecebe={s.opted_out} podeDesligar={s.can_disable} podeReligar={s.can_enable} />
    </div>
  );
}
