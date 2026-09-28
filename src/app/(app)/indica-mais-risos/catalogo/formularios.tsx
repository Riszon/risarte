"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ITEM_TIPOS,
  ITEM_TIPO_LABEL,
  PARCEIRO_TIPOS,
  PARCEIRO_TIPO_LABEL,
} from "@/lib/indica/rotulos";
import { salvarItem, salvarParceiro } from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type ItemCatalogo = {
  id: string;
  tipo: string;
  nome: string;
  descricao: string | null;
  custo_riso_coins: number;
  valor_centavos: number | null;
  parceiro_id: string | null;
  estoque: number | null;
  unidades: string[];
  nivel_minimo_id: string | null;
  ativo: boolean;
};

type Opcao = { id: string; nome: string };

export function ItemDialog({
  item,
  parceiros,
  niveis,
  unidades,
  podeRede,
}: {
  item?: ItemCatalogo;
  parceiros: Opcao[];
  niveis: Opcao[];
  /** Unidades em que esta pessoa pode oferecer item (gestor delas). */
  unidades: Opcao[];
  /** Franqueadora: pode deixar o item valendo na rede toda. */
  podeRede: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [gravando, gravar] = useTransition();
  const [tipo, setTipo] = useState(item?.tipo ?? "credito_risarte");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    gravar(async () => {
      const r = await salvarItem(fd, item?.id);
      if (r.ok) {
        toast.success(item ? "Item atualizado." : "Item cadastrado.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          item ? (
            <Button size="sm" variant="outline" className="h-7 text-xs">Editar</Button>
          ) : (
            <Button size="sm"><Plus className="mr-1 size-4" />Novo item</Button>
          )
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? `Editar ${item.nome}` : "Novo item do catálogo"}</DialogTitle>
          <DialogDescription>
            Procedimento clínico nunca é prêmio: use Crédito Risarte (vale em qualquer tratamento,
            depois da avaliação).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="tipo">Tipo *</Label>
            <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectClass}>
              {ITEM_TIPOS.map((t) => (
                <option key={t} value={t}>{ITEM_TIPO_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" name="nome" defaultValue={item?.nome} required />
          </div>
          <div>
            <Label htmlFor="descricao">Descrição</Label>
            <Input id="descricao" name="descricao" defaultValue={item?.descricao ?? ""} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="custo">Custo (Riso Coins) *</Label>
              <Input id="custo" name="custo_riso_coins" inputMode="numeric" defaultValue={item?.custo_riso_coins} required />
            </div>
            <div>
              <Label htmlFor="valor">Valor (R$){tipo === "credito_risarte" ? " *" : ""}</Label>
              <Input
                id="valor"
                name="valor"
                inputMode="decimal"
                defaultValue={item?.valor_centavos ? (item.valor_centavos / 100).toFixed(2).replace(".", ",") : ""}
                placeholder="100,00"
              />
            </div>
            <div>
              <Label htmlFor="estoque">Estoque</Label>
              <Input id="estoque" name="estoque" inputMode="numeric" defaultValue={item?.estoque ?? ""} placeholder="ilimitado" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="parceiro">Parceiro</Label>
              <select id="parceiro" name="parceiro_id" defaultValue={item?.parceiro_id ?? ""} className={selectClass}>
                <option value="">—</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="nivel">Nível mínimo</Label>
              <select id="nivel" name="nivel_minimo_id" defaultValue={item?.nivel_minimo_id ?? ""} className={selectClass}>
                <option value="">Todos os níveis</option>
                {niveis.map((n) => (
                  <option key={n.id} value={n.id}>{n.nome}</option>
                ))}
              </select>
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Onde vale</legend>
            <p className="text-xs text-muted-foreground">
              {podeRede ? "Nenhuma marcada = a rede toda." : "Marque as suas unidades."}
            </p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {unidades.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="unidades" value={u.id} defaultChecked={item?.unidades.includes(u.id)} />
                  {u.nome}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ativo" defaultChecked={item?.ativo ?? true} />
            Ativo (aparece para resgate)
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={gravando}>{gravando ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type Parceiro = {
  id: string;
  nome: string;
  tipo: string;
  contato: string | null;
  codigo: string | null;
  unidade_id: string | null;
  ativo: boolean;
};

export function ParceiroDialog({
  parceiro,
  unidades,
  podeRede,
}: {
  parceiro?: Parceiro;
  unidades: Opcao[];
  podeRede: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [gravando, gravar] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    gravar(async () => {
      const r = await salvarParceiro(fd, parceiro?.id);
      if (r.ok) {
        toast.success(parceiro ? "Parceiro atualizado." : "Parceiro cadastrado.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          parceiro ? (
            <Button size="sm" variant="outline" className="h-7 text-xs">Editar</Button>
          ) : (
            <Button size="sm" variant="outline"><Plus className="mr-1 size-4" />Novo parceiro</Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{parceiro ? `Editar ${parceiro.nome}` : "Novo parceiro"}</DialogTitle>
          <DialogDescription>Empresas que dão vouchers e/ou indicam clientes com código próprio.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="p-nome">Nome *</Label>
            <Input id="p-nome" name="nome" defaultValue={parceiro?.nome} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-tipo">Tipo *</Label>
              <select id="p-tipo" name="tipo" defaultValue={parceiro?.tipo ?? "voucher"} className={selectClass}>
                {PARCEIRO_TIPOS.map((t) => (
                  <option key={t} value={t}>{PARCEIRO_TIPO_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="p-codigo">Código (para indicar)</Label>
              <Input id="p-codigo" name="codigo" defaultValue={parceiro?.codigo ?? ""} placeholder="ex.: PADARIA10" />
            </div>
          </div>
          <div>
            <Label htmlFor="p-contato">Contato</Label>
            <Input id="p-contato" name="contato" defaultValue={parceiro?.contato ?? ""} />
          </div>
          <div>
            <Label htmlFor="p-unidade">Unidade</Label>
            <select id="p-unidade" name="unidade_id" defaultValue={parceiro?.unidade_id ?? ""} className={selectClass}>
              {podeRede && <option value="">Rede toda</option>}
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ativo" defaultChecked={parceiro?.ativo ?? true} />
            Ativo
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={gravando}>{gravando ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
