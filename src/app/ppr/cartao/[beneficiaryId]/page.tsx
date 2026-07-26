import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import { PrintButton } from "../../adesoes/[id]/contrato/print-button";

export const metadata: Metadata = { title: "Cartão do beneficiário — PPR+" };

/**
 * Cartão do beneficiário — para imprimir e entregar ou enviar em arquivo.
 * O código é rastreável: a unidade confere em /ppr/validar.
 */
export default async function PprCardPage(
  props: PageProps<"/ppr/cartao/[beneficiaryId]">
) {
  await getSessionContext();
  const { beneficiaryId } = await props.params;
  const supabase = await createClient();

  const { data: b } = await supabase
    .from("ppr_beneficiaries")
    .select(
      "id, role, relationship, card_code, joined_at, left_at, client:clients!ppr_beneficiaries_client_id_fkey ( full_name, cpf ), membership:ppr_memberships ( status, activated_at, plan:ppr_plans ( name ) ), clinic:clinics!ppr_beneficiaries_clinic_id_fkey ( name )"
    )
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (!b) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const client = one(
    b.client as unknown as
      | { full_name: string; cpf: string | null }
      | { full_name: string; cpf: string | null }[]
      | null
  );
  const membership = one(
    b.membership as unknown as
      | { status: string; activated_at: string | null; plan: unknown }
      | { status: string; activated_at: string | null; plan: unknown }[]
      | null
  );
  const plan = one(
    (membership?.plan ?? null) as { name: string } | { name: string }[] | null
  );
  const clinic = one(
    b.clinic as unknown as { name: string } | { name: string }[] | null
  );
  const status = (membership?.status ?? "cancelado") as PprStatus;
  const active = status === "ativo" && !b.left_at;

  return (
    <div className="mx-auto max-w-[210mm] px-6 py-8 text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="javascript:history.back()" className="text-sm underline">
          ← Voltar
        </a>
        <PrintButton />
      </div>

      {/* Cartão (tamanho aproximado de cartão de crédito) --------------- */}
      <div className="mx-auto w-[86mm] overflow-hidden rounded-xl border border-black/10 bg-[#0b1f3a] text-white shadow-sm print:shadow-none">
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">
              Risarte Odontologia
            </p>
            <p className="text-base font-semibold leading-tight text-[#d4af37]">
              Riso+ Prevenção
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${
              active ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/70"
            }`}
          >
            {PPR_STATUS_LABELS[status]}
          </span>
        </div>

        <div className="px-4 pb-4 pt-6">
          <p className="text-[10px] uppercase tracking-wider text-white/50">
            Beneficiário
          </p>
          <p className="truncate text-sm font-medium">{client?.full_name}</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">
                Plano
              </p>
              <p className="text-xs">{plan?.name ?? "PPR+"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">
                Vínculo
              </p>
              <p className="text-xs">
                {b.role === "titular"
                  ? "Titular"
                  : (b.relationship ?? "Dependente")}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-white/50">
                Unidade
              </p>
              <p className="truncate text-xs">{clinic?.name ?? "Rede Risarte"}</p>
            </div>
          </div>

          <div className="mt-3 border-t border-white/15 pt-2">
            <p className="text-[10px] uppercase tracking-wider text-white/50">
              Código do cartão
            </p>
            <p className="font-mono text-lg tracking-[0.15em] text-[#d4af37]">
              {b.card_code ?? "—"}
            </p>
          </div>

          <p className="mt-2 text-[9px] leading-tight text-white/50">
            {membership?.activated_at
              ? `Beneficiário desde ${new Date(membership.activated_at).toLocaleDateString("pt-BR")}`
              : "Aguardando ativação"}{" "}
            · benefícios válidos em toda a rede Risarte
          </p>
        </div>
      </div>

      {/* Verso / instruções -------------------------------------------- */}
      <div className="mx-auto mt-4 w-[86mm] rounded-xl border p-3 text-[10px] leading-snug text-black/70">
        <p className="mb-1 font-semibold uppercase tracking-wide text-black">
          Como usar
        </p>
        <p>
          Apresente este cartão na unidade Risarte. A equipe confere o código em{" "}
          <strong>PPR+ → Validar cartão</strong> e libera os benefícios do plano.
        </p>
        <p className="mt-1">
          Cartão pessoal e intransferível. Benefícios válidos enquanto o plano
          estiver ativo e as mensalidades em dia.
        </p>
        {client?.cpf && <p className="mt-1">CPF {client.cpf}</p>}
      </div>

      <p className="mt-6 text-center text-xs text-black/50 print:hidden">
        Dica: imprima e entregue ao cliente, ou salve em PDF para enviar pelo
        WhatsApp.
      </p>
    </div>
  );
}
