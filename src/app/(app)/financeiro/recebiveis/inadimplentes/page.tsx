import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { cobertura, promessasVencidas } from "@/lib/finance/collection";
import { AbasDeRecebiveis } from "../abas";
import { carregarFilaDeCobranca } from "./dados";
import { ListaDeCobranca } from "./lista";

export const metadata: Metadata = { title: "Inadimplentes" };

/**
 * A FILA DE COBRANÇA (relato OC-00009).
 *
 * *"Seria interessante ter uma aba de inadimplentes contendo NOME - TELEFONE -
 * VALOR DEVEDOR - CAMPO EDITÁVEL PARA INFORMAR RETORNO DO CONTATO."*
 *
 * A tela de Recebíveis já tinha nome, valor e o indicador (OC-00005) — mas
 * numa linha por COBRANÇA, e sem telefone. Aqui a dívida é somada por PESSOA,
 * o telefone aparece (e disca), e cada tentativa de contato fica registrada.
 *
 * ⚠️ Esta é uma LISTA OPERACIONAL DE COBRANÇA, não um relatório gerencial —
 * por isso ela mostra nome e telefone, contra a regra geral de anonimizar
 * paciente em relatório (CLAUDE.md §6). Ela existe para alguém ligar, e
 * anonimizada não serviria para nada. Fica atrás da mesma permissão do resto
 * do Financeiro da unidade, e cada registro de contato entra na auditoria.
 */
export default async function InadimplentesPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { fila, semCliente, contatosIndisponiveis } =
    await carregarFilaDeCobranca(supabase, clinicId);

  const hoje = todayInBrazil();
  const atrasadas = promessasVencidas(fila, hoje);
  const cob = cobertura(fila);
  const total = fila.reduce((s, p) => s + p.vencidoCents, 0);
  const semTelefone = fila.filter((p) => !p.telefone).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <PhoneCall className="size-6 text-primary" />
          Inadimplentes
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic?.name} · quem ligar hoje, para qual número, e
          quanto cobrar. Uma linha por pessoa — não por cobrança.
        </p>
      </div>

      <AbasDeRecebiveis ativa="inadimplentes" />

      {contatosIndisponiveis && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <strong>Não consegui ler os contatos registrados.</strong> A lista de
          devedores abaixo está correta, mas a coluna &ldquo;último
          contato&rdquo; pode aparecer vazia mesmo para quem já foi contatado.
          Confirme se a migração 0255 foi aplicada neste banco.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        {/* ⚠️ Este total é MAIOR que o "Vencido" da visão geral, de propósito:
            aqui entram multa e juros, porque é o que se cobra da pessoa; lá é
            só o principal, porque é o que a taxa de inadimplência compara
            contra o principal a receber. Dois números para duas perguntas. */}
        <Numero
          rotulo="Pessoas a cobrar"
          valor={String(fila.length)}
          detalhe={`${formatBRL(total)} a cobrar, com multa e juros`}
          destaque
        />
        <Numero
          rotulo="Ainda sem contato"
          valor={String(cob.semContato)}
          // Régua vazia grita: fila vazia não vira "0% contatado", que acusaria
          // de omissão quem não tem o que cobrar.
          detalhe={
            cob.percentual === null
              ? "Nada a cobrar nesta unidade."
              : `${cob.percentual}% da fila já foi contatada`
          }
          alerta={cob.semContato > 0}
        />
        <Numero
          rotulo="Prometeram e não pagaram"
          valor={String(atrasadas.length)}
          detalhe="o dia combinado já passou"
          alerta={atrasadas.length > 0}
        />
        <Numero
          rotulo="Sem telefone"
          valor={String(semTelefone)}
          detalhe="não dá para ligar até completar a ficha"
          alerta={semTelefone > 0}
        />
      </section>

      {semCliente > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>
            {semCliente} cobrança{semCliente === 1 ? "" : "s"} vencida
            {semCliente === 1 ? "" : "s"} sem paciente vinculado.
          </strong>{" "}
          Elas somam no total da unidade, mas não aparecem aqui: sem pessoa não
          há para quem ligar. Estão na{" "}
          <Link href="/financeiro/recebiveis?mostrar=vencidas" className="underline">
            visão geral
          </Link>
          .
        </p>
      )}

      <ListaDeCobranca
        fila={fila}
        promessasVencidasIds={atrasadas.map((p) => p.clientId)}
      />

      <p className="text-xs text-muted-foreground">
        O valor devedor é o de <strong>hoje</strong>: principal, benefício
        perdido, multa e juros — a mesma conta da ficha do paciente. Quem tem só
        parcela a vencer não aparece aqui; a vencer não é atraso.
      </p>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  detalhe,
  destaque = false,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <Card
      className={cn(
        destaque && "border-primary/35",
        alerta && "border-destructive/40"
      )}
    >
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold tabular-nums",
            alerta && "text-destructive"
          )}
        >
          {valor}
        </p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  );
}
