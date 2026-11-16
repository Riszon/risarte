import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { PainelDasCobrancasAutomaticas, type DadosDoPainel } from "./painel";
import { OperacoesInterrompidas, type OperacaoInterrompida } from "./operacoes-interrompidas";
import { PedidosDeExcecao, type PedidoDeExcecao } from "./pedidos-de-excecao";
import { MensalidadesDaUnidade } from "./mensalidades-da-unidade";
import { todayInBrazil } from "@/lib/dates";

export const metadata: Metadata = { title: "Cobranças automáticas" };

/**
 * 4012 (ASA4, entrega 1; spec 19.4 e 19.10 item 5) — A CRIAÇÃO AUTOMÁTICA DAS
 * COBRANÇAS: unidades ligadas, prazo, as parcelas que deviam ter cobrança e
 * ainda não têm (com o motivo), as rodadas de cada rotina (origem: Vercel,
 * banco, "Rodar agora", gatilho) e o botão "Rodar agora" (Admin Master).
 * Quem vê: Admin Master, Financeiro da Franqueadora e o Gerente (a unidade dele).
 */
export default async function CobrancasAutomaticasPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");
  const supabase = await createClient();
  const daRede = session.isAdminMaster || Object.values(session.rolesByClinic).flat().includes("finance_franchisor");
  const unidade = daRede ? null : (session.activeClinic?.id ?? null);
  const { data, error } = await supabase.rpc("auto_charge_panel_read", { p_clinic_id: unidade });
  // 4015: as operações interrompidas (boleto cancelado sem a mudança).
  const { data: interrompidas } = await supabase.rpc("boleto_op_failures_read", { p_clinic_id: unidade });
  // 4017a: os pedidos de exceção (a rede para o Financeiro e o Admin; a unidade para o Gerente).
  const { data: pedidosDeExcecao } = await supabase.rpc("sale_cancel_exceptions_read");

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="size-6 text-primary" />
          Cobranças automáticas
        </h1>
        <p className="text-sm text-muted-foreground">
          A cobrança nasce no Asaas na assinatura do contrato (as que vencem dentro do prazo) e as seguintes nascem pela
          rotina diária, antes do vencimento.
        </p>
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error.message.includes("NOT_ALLOWED")
            ? "Esta tela é do Admin Master, do Financeiro da Franqueadora e do Gerente da unidade."
            : /does not exist|schema cache/i.test(error.message)
              ? "A criação automática ainda não está ligada neste banco (falta a migração 4012)."
              : "Não foi possível ler a criação automática."}
        </p>
      ) : (
        <>
          <PedidosDeExcecao itens={((pedidosDeExcecao ?? []) as PedidoDeExcecao[])} />
          {/* 4018: a chave das mensalidades pelo Asaas, da unidade ativa (Gerente ou Admin). */}
          {session.activeClinic?.id && (
            <MensalidadesDaUnidade clinicId={session.activeClinic.id} clinicName={session.activeClinic.name} hoje={todayInBrazil()} />
          )}
          <OperacoesInterrompidas itens={((interrompidas ?? []) as OperacaoInterrompida[])} />
          <PainelDasCobrancasAutomaticas dados={data as DadosDoPainel} />
        </>
      )}
    </div>
  );
}
