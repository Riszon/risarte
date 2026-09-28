import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import {
  CAMPANHA_STATUS_COR,
  CAMPANHA_STATUS_LABEL,
  resumoPublico,
  resumoRegras,
  situacaoOrcamento,
} from "@/lib/indica/campanhas";
import { formatBrDate } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CAMPOS_CAMPANHA, consumos, type Campanha } from "./dados";
import { opcoesDaCampanha, parametroDaRede } from "./opcoes";

export const metadata: Metadata = { title: "Campanhas — Indica +Risos" };

export default async function CampanhasPage() {
  const session = await getSessionContext();
  const db = await indicaDb();
  const [{ data, error }, opcoes, alerta] = await Promise.all([
    db.from("campanhas").select(CAMPOS_CAMPANHA).order("criado_em", { ascending: false }).returns<Campanha[]>(),
    opcoesDaCampanha(),
    parametroDaRede<number>("campanha_alerta_orcamento_percentual"),
  ]);
  const lista = data ?? [];
  const consumo = await consumos(lista.map((c) => c.id));
  const nomeUnidade = new Map(opcoes.todasUnidades.map((u) => [u.id, u.nome]));
  const nomes = {
    niveis: new Map(opcoes.niveis.map((n) => [n.id, n.nome])),
    empresas: new Map(opcoes.empresas.map((e) => [e.id, e.nome])),
  };
  const podeCriar = ehFranqueadoraIndica(session) || opcoes.unidades.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Campanha ativa só amplia as regras. Cada indicação entra sozinha na campanha mais vantajosa
            para o Embaixador, e a regra fica congelada nela.
          </p>
        </div>
        {podeCriar && (
          <Button nativeButton={false} render={<Link href="/indica-mais-risos/campanhas/nova" />}>
            <Plus className="mr-1 size-4" /> Nova campanha
          </Button>
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma campanha ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Onde · para quem</TableHead>
                <TableHead>Vantagem</TableHead>
                <TableHead className="text-right">Consumo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => {
                const k = consumo.get(c.id);
                const farol = situacaoOrcamento(k?.percentual, Number(alerta ?? 100));
                return (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-56">
                      <Link href={`/indica-mais-risos/campanhas/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.nome}
                      </Link>
                      {c.descricao && <span className="block truncate text-xs text-muted-foreground">{c.descricao}</span>}
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAMPANHA_STATUS_COR[c.status]}`}>
                        {CAMPANHA_STATUS_LABEL[c.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatBrDate(c.inicio)} a {formatBrDate(c.fim)}
                    </TableCell>
                    <TableCell className="max-w-64 text-xs">
                      {c.escopo === "rede" ? "Rede toda" : c.unidades.map((u) => nomeUnidade.get(u) ?? "unidade").join(", ")}
                      <span className="block text-muted-foreground">{resumoPublico(c.publico, nomes)}</span>
                      {c.especialidade && <span className="block text-muted-foreground">Alvo: {c.especialidade}</span>}
                    </TableCell>
                    <TableCell className="max-w-64 text-xs">{resumoRegras(c.regras).join(" · ")}</TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">
                      {k ? (
                        <>
                          {k.riso_coins} RC · {formatBRL(k.custo_centavos)}
                          {k.orcamento_max_centavos ? (
                            <span
                              className={`block text-xs ${
                                farol === "esgotado"
                                  ? "text-destructive"
                                  : farol === "alerta"
                                    ? "text-amber-700 dark:text-amber-300"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {String(k.percentual ?? 0).replace(".", ",")}% de {formatBRL(k.orcamento_max_centavos)}
                              {farol === "esgotado" ? " — esgotado" : farol === "alerta" ? " — atenção" : ""}
                            </span>
                          ) : (
                            <span className="block text-xs text-muted-foreground">sem teto</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
