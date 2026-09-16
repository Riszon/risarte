import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
import {
  cobertura,
  dataDoFiltro,
  promessasVencidas,
  rotuloDoPeriodo,
  situacaoDaMargem,
} from "@/lib/finance/collection";
import { AbasDeRecebiveis } from "../abas";
import { carregarFilaDeCobranca } from "./dados";
import { ListaDeCobranca } from "./lista";
import { BotoesDeRelatorio } from "@/components/botoes-de-relatorio";

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
export default async function InadimplentesPage(
  props: PageProps<"/financeiro/recebiveis/inadimplentes">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return (s ?? "").trim() || null;
  };
  const de = dataDoFiltro(pick("de"));
  const ate = dataDoFiltro(pick("ate"));

  // ⚠️ A FRANQUEADORA ESCOLHE A UNIDADE (pedido do Admin Master). Quem não é
  // rede fica preso à clínica ativa — e a RLS recusaria de qualquer jeito;
  // isto é para a tela não oferecer uma porta que o banco vai fechar.
  const podeEscolherUnidade =
    session.isAdminMaster || isFinanceFranchisor(session);
  const supabase = await createClient();

  let unidades: { id: string; name: string }[] = [];
  if (podeEscolherUnidade) {
    const { data } = await supabase
      .from("clinics")
      .select("id, name")
      .order("name")
      .returns<{ id: string; name: string }[]>();
    unidades = data ?? [];
  }

  const escolhida = pick("unidade");
  const clinicId =
    (podeEscolherUnidade && escolhida
      ? unidades.find((u) => u.id === escolhida)?.id
      : null) ?? session.activeClinic?.id ?? null;

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const nomeDaUnidade =
    unidades.find((u) => u.id === clinicId)?.name ??
    session.activeClinic?.name ??
    "Unidade";

  const { fila, semCliente, contatosIndisponiveis } =
    await carregarFilaDeCobranca(supabase, clinicId, { de, ate });

  // A taxa e o limite vêm do BANCO (`clinic_overdue_rate`), a mesma função que
  // a visão geral usa — e ela olha a unidade INTEIRA, não o filtro. É de
  // propósito: taxa de inadimplência de um recorte de datas não é taxa de
  // inadimplência de ninguém.
  const { data: taxaRows } = await supabase.rpc("clinic_overdue_rate", {
    p_clinic_id: clinicId,
  });
  const t = ((taxaRows ?? []) as {
    overdue_percent: number | null;
    limit_percent: number | null;
  }[])[0];
  const taxaPercent =
    t?.overdue_percent == null ? null : Number(t.overdue_percent);
  const limitePercent =
    t?.limit_percent == null ? null : Number(t.limit_percent);

  const hoje = todayInBrazil();
  const atrasadas = promessasVencidas(fila, hoje);
  const cob = cobertura(fila);
  const total = fila.reduce((s, p) => s + p.vencidoCents, 0);
  const semTelefone = fila.filter((p) => !p.telefone).length;
  const periodo = rotuloDoPeriodo(de, ate, (iso) =>
    formatBrDate(`${iso}T12:00:00`)
  );
  const filtrando = Boolean(de || ate);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <PhoneCall className="size-6 text-primary print:hidden" />
            Inadimplentes
          </h1>
          <p className="text-sm text-muted-foreground">
            {nomeDaUnidade} · quem ligar hoje, para qual número, e quanto
            cobrar. Uma linha por pessoa — não por cobrança.
          </p>
        </div>
        <BotoesDeRelatorio
          base="/financeiro/recebiveis/inadimplentes"
          filtros={{ de, ate, unidade: clinicId }}
          desabilitado={fila.length === 0}
        />
      </div>

      <div className="print:hidden">
        <AbasDeRecebiveis
          ativa="inadimplentes"
          veRede={podeEscolherUnidade}
        />
      </div>

      {contatosIndisponiveis && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <strong>Não consegui ler os contatos registrados.</strong> A lista de
          devedores abaixo está correta, mas a coluna &ldquo;último
          contato&rdquo; pode aparecer vazia mesmo para quem já foi contatado.
          Confirme se a migração 0255 foi aplicada neste banco.
        </p>
      )}

      <FilterForm className="grid gap-3 sm:grid-cols-4 print:hidden">
        {podeEscolherUnidade && unidades.length > 0 && (
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Unidade</span>
            <select
              name="unidade"
              defaultValue={clinicId}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">
            Vencimento de
          </span>
          <Input type="date" name="de" defaultValue={de ?? ""} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">até</span>
          <Input type="date" name="ate" defaultValue={ate ?? ""} />
        </label>
      </FilterForm>

      <section className="grid gap-3 sm:grid-cols-4">
        <Numero
          rotulo="Pessoas a cobrar"
          valor={String(fila.length)}
          detalhe={`${formatBRL(total)} a cobrar, com multa e juros`}
          destaque
        />
        <Numero
          rotulo="Ainda sem contato"
          valor={String(cob.semContato)}
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
          rotulo="Inadimplência da unidade"
          valor={taxaPercent === null ? "—" : `${taxaPercent}%`}
          detalhe={situacaoDaMargem(taxaPercent, limitePercent)}
          alerta={
            taxaPercent !== null &&
            limitePercent !== null &&
            taxaPercent > limitePercent
          }
        />
      </section>

      {filtrando && (
        // ⚠️ O RECORTE NÃO É O TOTAL DA UNIDADE, e a tela precisa dizer isso.
        // Sem esta linha, alguém exporta "março" e lê o número como se fosse a
        // inadimplência inteira — e a taxa dos quadros continua sendo da
        // unidade toda, o que tornaria a leitura errada ainda mais plausível.
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>Isto é um recorte por período</strong> ({periodo.toLowerCase()}
          ): {fila.length} pessoa(s) e {formatBRL(total)}. A{" "}
          <strong>taxa de inadimplência</strong> acima continua sendo a da
          unidade inteira — taxa de um recorte de datas não é taxa de ninguém.
        </p>
      )}

      {semTelefone > 0 && (
        <p className="text-sm text-destructive print:text-black">
          <strong>{semTelefone}</strong>{" "}
          {semTelefone === 1 ? "pessoa está" : "pessoas estão"} sem telefone no
          cadastro — não dá para ligar até alguém completar a ficha.
        </p>
      )}

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
