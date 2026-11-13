import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { podeExcluirDividas, podeLancarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import { COLUNAS_DA_DIVIDA, carregarBase, dividaDaLinha } from "../dados";
import { DetalheDaDivida } from "./detalhe-da-divida";

/** O detalhe de uma dívida (0404): Dados · Contatos · Histórico. */
export default async function DividaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [base, { data }] = await Promise.all([
    carregarBase(),
    supabase.from("debts").select(`${COLUNAS_DA_DIVIDA}, deleted_at, deleted_reason`).eq("id", id).maybeSingle(),
  ]);
  if (!data) notFound();
  const linha = data as unknown as Record<string, unknown>;
  const divida = dividaDaLinha(linha);

  const pessoas = [divida.createdBy, divida.updatedBy, divida.ownerUserId].filter((x): x is string => !!x);
  const { data: perfis } = pessoas.length
    ? await supabase.from("profiles").select("id, full_name").in("id", pessoas)
    : { data: [] as { id: string; full_name: string }[] };
  const nomes = Object.fromEntries(((perfis ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <Link href="/financeiro/dividas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Levantamento de Dívidas
      </Link>
      <DetalheDaDivida
        base={base}
        divida={divida}
        excluida={linha.deleted_at ? { em: String(linha.deleted_at), motivo: String(linha.deleted_reason ?? "") } : null}
        nomes={nomes}
        hoje={todayInBrazil()}
        podeLancar={podeLancarDividas(session)}
        podeExcluir={podeExcluirDividas(session)}
      />
    </div>
  );
}
