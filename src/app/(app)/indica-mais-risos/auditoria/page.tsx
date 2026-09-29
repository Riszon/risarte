import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import {
  ALERTA_STATUS_LABEL,
  REGRA_FRAUDE_LABEL,
  SEVERIDADE_COR,
  SEVERIDADE_LABEL,
  descreverAlerta,
} from "@/lib/indica/painel";
import { formatBrDateTime } from "@/lib/dates";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DecidirAlerta, RodarConferencia } from "./botoes";

export const metadata: Metadata = { title: "Auditoria — Indica +Risos" };

type Alerta = {
  id: string;
  indicacao_id: string | null;
  embaixador_id: string | null;
  unidade_id: string | null;
  usuario_id: string | null;
  regra: string;
  severidade: string;
  detalhes: Record<string, unknown>;
  status: string;
  motivo: string | null;
  resolvido_por: string | null;
  resolvido_em: string | null;
  criado_em: string;
};
type Ajuste = {
  id: number;
  embaixador_id: string;
  riso_coins: number;
  motivo: string | null;
  criado_por: string | null;
  criado_em: string;
};

export default async function AuditoriaPage({ searchParams }: PageProps<"/indica-mais-risos/auditoria">) {
  const sp = await searchParams;
  const session = await getSessionContext();
  const franqueadora = ehFranqueadoraIndica(session);
  const gestorDeAlguma = Object.keys(session.rolesByClinic).some((c) => ehGestorIndica(session, c));
  if (!franqueadora && !gestorDeAlguma) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria e antifraude</h1>
        <p className="mt-2 text-sm text-muted-foreground">A auditoria é da franqueadora e do gestor da unidade.</p>
      </div>
    );
  }
  const situacao = sp.situacao === "todos" ? "todos" : "abertos";
  const db = await indicaDb();
  const supabase = await createClient();
  let consulta = db
    .from("alertas_fraude")
    .select("id, indicacao_id, embaixador_id, unidade_id, usuario_id, regra, severidade, detalhes, status, motivo, resolvido_por, resolvido_em, criado_em")
    .order("criado_em", { ascending: false })
    .limit(200);
  if (situacao === "abertos") consulta = consulta.in("status", ["aberto", "em_analise"]);
  const [{ data: alertas, error }, { data: ajustes }, { data: execucoes }, { data: clinicas }] = await Promise.all([
    consulta.returns<Alerta[]>(),
    db.from("pontos_lancamentos").select("id, embaixador_id, riso_coins, motivo, criado_por, criado_em")
      .eq("tipo", "ajuste").not("criado_por", "is", null).order("criado_em", { ascending: false }).limit(50)
      .returns<Ajuste[]>(),
    db.from("rotinas_execucoes").select("executada_em, resultado").eq("resultado->>rotina", "antifraude")
      .order("id", { ascending: false }).limit(1)
      .returns<{ executada_em: string; resultado: Record<string, unknown> }[]>(),
    supabase.from("clinics").select("id, name").returns<{ id: string; name: string }[]>(),
  ]);

  const idsEmb = [...new Set([...(alertas ?? []).map((a) => a.embaixador_id), ...(ajustes ?? []).map((a) => a.embaixador_id)].filter(Boolean))] as string[];
  const idsPessoas = [...new Set([...(alertas ?? []).flatMap((a) => [a.usuario_id, a.resolvido_por]), ...(ajustes ?? []).map((a) => a.criado_por)].filter(Boolean))] as string[];
  const idsInd = [...new Set((alertas ?? []).map((a) => a.indicacao_id).filter(Boolean))] as string[];
  const [{ data: embs }, { data: pessoas }, { data: inds }] = await Promise.all([
    idsEmb.length ? db.from("embaixadores").select("id, codigo").in("id", idsEmb).returns<{ id: string; codigo: string }[]>() : Promise.resolve({ data: [] }),
    idsPessoas.length ? supabase.from("profiles").select("id, full_name").in("id", idsPessoas).returns<{ id: string; full_name: string }[]>() : Promise.resolve({ data: [] }),
    idsInd.length ? db.from("indicacoes").select("id, codigo").in("id", idsInd).returns<{ id: string; codigo: string }[]>() : Promise.resolve({ data: [] }),
  ]);
  const codEmb = new Map((embs ?? []).map((e) => [e.id, e.codigo]));
  const nome = new Map((pessoas ?? []).map((p) => [p.id, p.full_name]));
  const codInd = new Map((inds ?? []).map((i) => [i.id, i.codigo]));
  const clinica = new Map((clinicas ?? []).map((c) => [c.id, c.name]));
  const ultima = execucoes?.[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auditoria e antifraude</h1>
          <p className="text-sm text-muted-foreground">
            A conferência roda sozinha às 02:50
            {franqueadora ? (ultima ? ` (última: ${formatBrDateTime(ultima.executada_em)})` : " (ainda não rodou)") : ""}. Alerta <strong>alto</strong> em
            aberto segura os resgates do Embaixador até a franqueadora decidir. Os limites de cada regra ficam em
            Configurações → Antifraude.
          </p>
        </div>
        {franqueadora && <RodarConferencia />}
      </div>

      <FilterForm className="flex items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Mostrar
          <select name="situacao" defaultValue={situacao} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
            <option value="abertos">Abertos e em análise</option>
            <option value="todos">Todos</option>
          </select>
        </label>
      </FilterForm>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Alertas</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {error ? (
            <p className="px-4 py-3 text-sm text-destructive">{mensagemDoBanco(error)}</p>
          ) : (alertas ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum alerta {situacao === "abertos" ? "em aberto" : ""}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Regra</TableHead>
                  <TableHead>O que aconteceu</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(alertas ?? []).map((a) => {
                  const aberto = a.status === "aberto" || a.status === "em_analise";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatBrDateTime(a.criado_em)}</TableCell>
                      <TableCell className="text-sm">
                        {REGRA_FRAUDE_LABEL[a.regra] ?? a.regra}
                        <span className={`ml-1.5 rounded-full px-2 py-0.5 text-xs ${SEVERIDADE_COR[a.severidade] ?? ""}`}>
                          {SEVERIDADE_LABEL[a.severidade] ?? a.severidade}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-md text-xs">
                        {descreverAlerta(a.regra, a.detalhes)}
                        {a.indicacao_id && (
                          <Link href={`/indica-mais-risos/indicacoes/${a.indicacao_id}`} className="ml-1 text-primary hover:underline">
                            {codInd.get(a.indicacao_id) ?? "abrir"}
                          </Link>
                        )}
                        {a.unidade_id && <span className="block text-muted-foreground">{clinica.get(a.unidade_id) ?? ""}</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.embaixador_id && (
                          <Link href={`/indica-mais-risos/embaixadores/${a.embaixador_id}`} className="text-primary hover:underline">
                            {codEmb.get(a.embaixador_id) ?? "Embaixador"}
                          </Link>
                        )}
                        {a.usuario_id && <span className="block">{nome.get(a.usuario_id) ?? "Risartano"}</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {ALERTA_STATUS_LABEL[a.status] ?? a.status}
                        {aberto && a.severidade === "alta" && a.embaixador_id && (
                          <span className="block text-red-700 dark:text-red-400">resgates segurados</span>
                        )}
                        {a.motivo && <span className="block text-muted-foreground">{a.motivo}</span>}
                        {a.resolvido_por && (
                          <span className="block text-muted-foreground">
                            {nome.get(a.resolvido_por) ?? ""} · {a.resolvido_em ? formatBrDateTime(a.resolvido_em) : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {franqueadora && aberto && (
                          <DecidirAlerta id={a.id} status={a.status} bloqueia={a.severidade === "alta" && Boolean(a.embaixador_id)} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ajustes manuais de Riso Coins (últimos 50)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {(ajustes ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum ajuste manual.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem fez</TableHead>
                  <TableHead>Embaixador</TableHead>
                  <TableHead className="text-right">Riso Coins</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ajustes ?? []).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatBrDateTime(j.criado_em)}</TableCell>
                    <TableCell className="text-sm">{j.criado_por ? nome.get(j.criado_por) ?? "—" : "—"}</TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/indica-mais-risos/embaixadores/${j.embaixador_id}`} className="text-primary hover:underline">
                        {codEmb.get(j.embaixador_id) ?? "Embaixador"}
                      </Link>
                    </TableCell>
                    <TableCell className={`text-right ${j.riso_coins < 0 ? "text-destructive" : ""}`}>{j.riso_coins}</TableCell>
                    <TableCell className="text-sm">{j.motivo ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
