import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { ITEM_TIPO_LABEL, PARCEIRO_TIPO_LABEL, type ItemTipo, type ParceiroTipo } from "@/lib/indica/rotulos";
import { formatBRL } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemDialog, ParceiroDialog, type ItemCatalogo, type Parceiro } from "./formularios";

export const metadata: Metadata = { title: "Catálogo — Indica +Risos" };

export default async function CatalogoPage() {
  const session = await getSessionContext();
  const db = await indicaDb();
  const supabase = await createClient();
  const [{ data: itens, error }, { data: parceiros }, { data: niveis }, { data: todas }] = await Promise.all([
    db.from("catalogo_itens")
      .select("id, tipo, nome, descricao, custo_riso_coins, valor_centavos, parceiro_id, estoque, unidades, nivel_minimo_id, ativo")
      .order("ativo", { ascending: false })
      .order("custo_riso_coins")
      .returns<ItemCatalogo[]>(),
    db.from("parceiros").select("id, nome, tipo, contato, codigo, unidade_id, ativo").order("nome").returns<Parceiro[]>(),
    db.from("niveis").select("id, nome, ordem").order("ordem").returns<{ id: string; nome: string; ordem: number }[]>(),
    supabase.from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name")
      .returns<{ id: string; name: string }[]>(),
  ]);

  const franqueadora = ehFranqueadoraIndica(session);
  // Unidades em que esta pessoa pode oferecer item: todas (rede) ou as que gere.
  const minhas = (todas ?? []).filter((u) => franqueadora || ehGestorIndica(session, u.id));
  const opcoesUnidade = minhas.map((u) => ({ id: u.id, nome: u.name }));
  const nomeUnidade = new Map((todas ?? []).map((u) => [u.id, u.name]));
  const nomeParceiro = new Map((parceiros ?? []).map((p) => [p.id, p.nome]));
  const nomeNivel = new Map((niveis ?? []).map((n) => [n.id, n.nome]));
  const podeEditar = (unidades: string[]) =>
    franqueadora || (unidades.length > 0 && unidades.every((u) => ehGestorIndica(session, u)));
  const podeCriar = franqueadora || opcoesUnidade.length > 0;
  const listaParceiros = (parceiros ?? []).map((p) => ({ id: p.id, nome: p.nome }));
  const listaNiveis = (niveis ?? []).map((n) => ({ id: n.id, nome: n.nome }));

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo de recompensas</h1>
          <p className="text-sm text-muted-foreground">
            O resgate debita só o custo do item. Itens da rede: franqueadora; itens da unidade: gestor.
          </p>
        </div>
        {podeCriar && (
          <ItemDialog parceiros={listaParceiros} niveis={listaNiveis} unidades={opcoesUnidade} podeRede={franqueadora} />
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Riso Coins</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Estoque</TableHead>
                <TableHead>Onde vale</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(itens ?? []).map((i) => (
                <TableRow key={i.id} className={i.ativo ? "" : "opacity-60"}>
                  <TableCell>
                    <span className="font-medium">{i.nome}</span>
                    {!i.ativo && <Badge variant="outline" className="ml-2 text-[10px]">inativo</Badge>}
                    {i.parceiro_id && (
                      <span className="block text-xs text-muted-foreground">{nomeParceiro.get(i.parceiro_id)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{ITEM_TIPO_LABEL[i.tipo as ItemTipo] ?? i.tipo}</TableCell>
                  <TableCell className="text-right font-mono">{i.custo_riso_coins}</TableCell>
                  <TableCell className="text-right text-sm">{i.valor_centavos ? formatBRL(i.valor_centavos) : "—"}</TableCell>
                  <TableCell className="text-sm">{i.estoque ?? "ilimitado"}</TableCell>
                  <TableCell className="text-sm">
                    {i.unidades.length === 0 ? "Rede toda" : i.unidades.map((u) => nomeUnidade.get(u) ?? "?").join(", ")}
                  </TableCell>
                  <TableCell className="text-sm">{i.nivel_minimo_id ? nomeNivel.get(i.nivel_minimo_id) : "Todos"}</TableCell>
                  <TableCell className="text-right">
                    {podeEditar(i.unidades) && (
                      <ItemDialog item={i} parceiros={listaParceiros} niveis={listaNiveis} unidades={opcoesUnidade} podeRede={franqueadora} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(itens ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Catálogo vazio. Sugestão das diretrizes: Crédito Risarte de R$ 100 por 1.000 Riso Coins.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Parceiros</h2>
          {podeCriar && <ParceiroDialog unidades={opcoesUnidade} podeRede={franqueadora} />}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parceiro</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(parceiros ?? []).map((p) => (
                <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell className="text-sm">{PARCEIRO_TIPO_LABEL[p.tipo as ParceiroTipo] ?? p.tipo}</TableCell>
                  <TableCell className="font-mono text-xs">{p.codigo ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.contato ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.unidade_id ? nomeUnidade.get(p.unidade_id) : "Rede toda"}</TableCell>
                  <TableCell className="text-right">
                    {(p.unidade_id ? ehGestorIndica(session, p.unidade_id) : franqueadora) && (
                      <ParceiroDialog parceiro={p} unidades={opcoesUnidade} podeRede={franqueadora} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(parceiros ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum parceiro cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
