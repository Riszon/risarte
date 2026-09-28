import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditarNivel, EditarRede, EditarUnidade, type NivelEditavel, type Parametro } from "./editores";

export const metadata: Metadata = { title: "Configurações — Indica +Risos" };

type LinhaConfig = {
  unidade_id: string | null;
  grupo: string;
  chave: string;
  valor: unknown;
  min: number | null;
  max: number | null;
  travado: boolean;
  descricao: string | null;
  vigente_desde: string;
};

const GRUPOS: Record<string, string> = {
  pontuacao: "Pontuação",
  atribuicao: "Atribuição",
  indicado: "Benefício do indicado",
  resgate: "Resgate",
  niveis: "Níveis",
  equipe: "Equipe",
  regulamento: "Regulamento",
  portal: "Portal do Embaixador",
  lgpd: "LGPD",
  antifraude: "Antifraude",
};

function exibir(v: unknown): string {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (v === undefined || v === null) return "—";
  return String(v);
}

export default async function ConfiguracoesPage() {
  const session = await getSessionContext();
  const ativa = session.activeClinic;
  const unidade = ativa && ativa.type === "franchise_unit" ? ativa : null;
  const franqueadora = ehFranqueadoraIndica(session);
  const gestor = unidade ? ehGestorIndica(session, unidade.id) : false;

  const db = await indicaDb();
  const [{ data, error }, { data: niveis }] = await Promise.all([
    db.from("config")
      .select("unidade_id, grupo, chave, valor, min, max, travado, descricao, vigente_desde")
      .lte("vigente_desde", new Date().toISOString())
      .order("vigente_desde", { ascending: false })
      .returns<LinhaConfig[]>(),
    db.from("niveis").select("id, nome, ordem, criterio_conversoes, multiplicador, beneficios, ativo").order("ordem")
      .returns<(NivelEditavel & { ordem: number })[]>(),
  ]);

  // A mais recente de cada chave (rede) e da unidade ativa.
  const rede = new Map<string, LinhaConfig>();
  const daUnidade = new Map<string, LinhaConfig>();
  for (const l of data ?? []) {
    if (l.unidade_id === null && !rede.has(l.chave)) rede.set(l.chave, l);
    if (unidade && l.unidade_id === unidade.id && !daUnidade.has(l.chave)) daUnidade.set(l.chave, l);
  }
  const parametros: Parametro[] = [...rede.values()].map((l) => ({
    chave: l.chave,
    grupo: l.grupo,
    descricao: l.descricao,
    valorRede: l.valor,
    tipo: typeof l.valor,
    min: l.min,
    max: l.max,
    travado: l.travado,
    valorUnidade: daUnidade.get(l.chave)?.valor,
  }));
  const porGrupo = new Map<string, Parametro[]>();
  for (const p of parametros) porGrupo.set(p.grupo, [...(porGrupo.get(p.grupo) ?? []), p]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações do programa</h1>
        <p className="text-sm text-muted-foreground">
          Rede → Unidade → Campanha: a camada mais específica vale, dentro do que a franqueadora
          travou. Toda mudança grava uma versão nova; o histórico fica.
          {unidade ? ` Unidade ativa: ${unidade.name}.` : ""}
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      )}

      {[...porGrupo.entries()].map(([grupo, lista]) => (
        <Card key={grupo}>
          <CardHeader>
            <CardTitle className="text-sm">{GRUPOS[grupo] ?? grupo}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parâmetro</TableHead>
                  <TableHead>Rede</TableHead>
                  <TableHead>Faixa da unidade</TableHead>
                  {unidade && <TableHead>{unidade.name}</TableHead>}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.chave}>
                    <TableCell className="max-w-md">
                      <span className="font-mono text-xs">{p.chave}</span>
                      <span className="block text-xs text-muted-foreground">{p.descricao}</span>
                    </TableCell>
                    <TableCell className="font-medium">{exibir(p.valorRede)}</TableCell>
                    <TableCell className="text-sm">
                      {p.travado ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Lock className="size-3" /> travado
                        </span>
                      ) : p.min !== null || p.max !== null ? (
                        `${p.min ?? "—"} a ${p.max ?? "—"}`
                      ) : (
                        <span className="text-muted-foreground">livre</span>
                      )}
                    </TableCell>
                    {unidade && (
                      <TableCell className="text-sm">
                        {p.valorUnidade !== undefined ? (
                          <strong>{exibir(p.valorUnidade)}</strong>
                        ) : (
                          <span className="text-muted-foreground">usa a rede</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {franqueadora && <EditarRede p={p} />}
                        {unidade && gestor && !p.travado && (
                          <EditarUnidade p={p} unidadeId={unidade.id} unidadeNome={unidade.name} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Níveis de Embaixador</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nível</TableHead>
                <TableHead className="text-right">Fechamentos (12m)</TableHead>
                <TableHead className="text-right">Multiplicador</TableHead>
                <TableHead>Benefício</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(niveis ?? []).map((n) => (
                <TableRow key={n.id} className={n.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{n.nome}</TableCell>
                  <TableCell className="text-right">{n.criterio_conversoes}</TableCell>
                  <TableCell className="text-right">{String(Number(n.multiplicador)).replace(".", ",")}x</TableCell>
                  <TableCell className="text-sm">{n.beneficios}</TableCell>
                  <TableCell className="text-right">{franqueadora && <EditarNivel n={n} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
