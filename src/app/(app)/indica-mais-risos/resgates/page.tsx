import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import {
  RESGATE_STATUS,
  RESGATE_STATUS_COR,
  RESGATE_STATUS_LABEL,
  type ResgateStatus,
} from "@/lib/indica/rotulos";
import { formatBrDate } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { FilterForm } from "@/components/filter-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AcoesResgate, UsarVoucherDialog } from "./acoes-resgate";

export const metadata: Metadata = { title: "Resgates — Indica +Risos" };

type Linha = {
  id: string;
  codigo: string;
  status: ResgateStatus;
  unidade_id: string;
  embaixador_id: string;
  item_nome: string | null;
  item_tipo: string | null;
  riso_coins: number;
  valor_centavos: number | null;
  codigo_voucher: string | null;
  voucher_valido_ate: string | null;
  voucher_usado_em: string | null;
  cedido_para_nome: string | null;
  motivo: string | null;
  criado_em: string;
};

export default async function ResgatesPage(props: PageProps<"/indica-mais-risos/resgates">) {
  const session = await getSessionContext();
  const sp = await props.searchParams;
  const filtro = typeof sp.situacao === "string" ? sp.situacao : "abertos";
  const ativa = session.activeClinic;
  const naRede = !ativa || ativa.type === "franchisor";

  const db = await indicaDb();
  let consulta = db
    .from("resgates")
    .select(
      "id, codigo, status, unidade_id, embaixador_id, item_nome, item_tipo, riso_coins, valor_centavos, codigo_voucher, voucher_valido_ate, voucher_usado_em, cedido_para_nome, motivo, criado_em"
    )
    .order("criado_em", { ascending: false })
    .limit(300);
  if (!naRede && ativa) consulta = consulta.eq("unidade_id", ativa.id);
  if (filtro === "abertos") consulta = consulta.in("status", ["solicitado", "aprovado"]);
  else if ((RESGATE_STATUS as readonly string[]).includes(filtro)) consulta = consulta.eq("status", filtro);

  const { data, error } = await consulta.returns<Linha[]>();
  const linhas = data ?? [];

  const ids = [...new Set(linhas.map((l) => l.embaixador_id))];
  const { data: rotulos } = ids.length
    ? await db.from("v_embaixadores").select("id, codigo, nome").in("id", ids)
        .returns<{ id: string; codigo: string; nome: string }[]>()
    : { data: [] as { id: string; codigo: string; nome: string }[] };
  const embaixador = new Map((rotulos ?? []).map((e) => [e.id, e]));
  const supabase = await createClient();
  const { data: unidades } = naRede
    ? await supabase.from("clinics").select("id, name").eq("type", "franchise_unit")
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
  const agora = new Date();

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resgates</h1>
          <p className="text-sm text-muted-foreground">
            {naRede ? "Visão da rede" : ativa?.name} · pedido → aprovação (acima do limite) → entrega. Novo
            resgate: pela ficha do Embaixador.
          </p>
        </div>
        <UsarVoucherDialog />
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <select name="situacao" defaultValue={filtro} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="abertos">Em aberto (a aprovar e a entregar)</option>
          {RESGATE_STATUS.map((s) => (
            <option key={s} value={s}>
              {RESGATE_STATUS_LABEL[s]}
            </option>
          ))}
          <option value="todos">Todos</option>
        </select>
      </FilterForm>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Embaixador</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Riso Coins</TableHead>
                <TableHead>Situação</TableHead>
                {naRede && <TableHead>Unidade</TableHead>}
                <TableHead>Pedido em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const emb = embaixador.get(l.embaixador_id);
                const vencido = l.voucher_valido_ate && !l.voucher_usado_em && new Date(l.voucher_valido_ate) < agora;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.codigo}</TableCell>
                    <TableCell>
                      {emb ? (
                        <Link href={`/indica-mais-risos/embaixadores/${l.embaixador_id}`} className="hover:underline">
                          {emb.nome} <span className="font-mono text-[10px] text-muted-foreground">{emb.codigo}</span>
                        </Link>
                      ) : (
                        "—"
                      )}
                      {l.cedido_para_nome && (
                        <span className="block text-xs text-muted-foreground">cedido para {l.cedido_para_nome}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {l.item_nome}
                      {l.valor_centavos ? <span className="text-muted-foreground"> · {formatBRL(l.valor_centavos)}</span> : null}
                      {l.codigo_voucher && (
                        <span className="block font-mono text-xs">
                          {l.codigo_voucher}
                          {l.voucher_usado_em
                            ? ` · usado em ${formatBrDate(l.voucher_usado_em)}`
                            : l.voucher_valido_ate
                              ? ` · ${vencido ? "venceu" : "vale até"} ${formatBrDate(l.voucher_valido_ate)}`
                              : ""}
                        </span>
                      )}
                      {l.motivo && <span className="block text-xs text-muted-foreground">“{l.motivo}”</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{l.riso_coins}</TableCell>
                    <TableCell>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", RESGATE_STATUS_COR[l.status])}>
                        {RESGATE_STATUS_LABEL[l.status]}
                      </span>
                    </TableCell>
                    {naRede && <TableCell className="text-sm">{nomeUnidade.get(l.unidade_id) ?? ""}</TableCell>}
                    <TableCell className="text-sm">{formatBrDate(l.criado_em)}</TableCell>
                    <TableCell>
                      <AcoesResgate
                        gestor={ehGestorIndica(session, l.unidade_id)}
                        resgate={{ id: l.id, codigo: l.codigo, status: l.status, itemNome: l.item_nome }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={naRede ? 8 : 7} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum resgate {filtro === "abertos" ? "em aberto" : "com este filtro"}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
