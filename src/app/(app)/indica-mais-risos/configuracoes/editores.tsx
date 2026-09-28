"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { salvarNivel, salvarParametro } from "./actions";

export type Parametro = {
  chave: string;
  grupo: string;
  descricao: string | null;
  valorRede: unknown;
  tipo: string;
  min: number | null;
  max: number | null;
  travado: boolean;
  valorUnidade: unknown | undefined;
};

function mostrar(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Editar o padrão da REDE (franqueadora): valor, faixa e trava. */
export function EditarRede({ p }: { p: Parametro }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(mostrar(p.valorRede));
  const [min, setMin] = useState(p.min === null ? "" : String(p.min));
  const [max, setMax] = useState(p.max === null ? "" : String(p.max));
  const [travado, setTravado] = useState(p.travado);
  const [gravando, gravar] = useTransition();

  function salvar() {
    gravar(async () => {
      const r = await salvarParametro({
        chave: p.chave,
        unidadeId: null,
        valor,
        tipoDoPadrao: p.tipo,
        grupo: p.grupo,
        descricao: p.descricao,
        min,
        max,
        travado,
      });
      if (r.ok) {
        toast.success("Nova versão do padrão da rede gravada (vale daqui para frente).");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 text-xs">Rede</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{p.chave}</DialogTitle>
          <DialogDescription>
            {p.descricao} Regra muda só para o futuro: indicações já registradas mantêm a regra delas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="valor-rede">Padrão da rede</Label>
            {p.tipo === "boolean" ? (
              <select id="valor-rede" value={valor} onChange={(e) => setValor(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            ) : (
              <Input id="valor-rede" value={valor} onChange={(e) => setValor(e.target.value)} />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={travado} onChange={(e) => setTravado(e.target.checked)} />
            Travado — só a franqueadora define (as unidades não mexem)
          </label>
          {!travado && p.tipo === "number" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="min">Faixa da unidade: mínimo</Label>
                <Input id="min" value={min} onChange={(e) => setMin(e.target.value)} placeholder="sem mínimo" />
              </div>
              <div>
                <Label htmlFor="max">máximo</Label>
                <Input id="max" value={max} onChange={(e) => setMax(e.target.value)} placeholder="sem máximo" />
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando}>{gravando ? "Gravando…" : "Gravar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editar o valor da UNIDADE ativa (gestor), dentro da faixa da rede. */
export function EditarUnidade({ p, unidadeId, unidadeNome }: { p: Parametro; unidadeId: string; unidadeNome: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(mostrar(p.valorUnidade ?? p.valorRede));
  const [gravando, gravar] = useTransition();

  function salvar() {
    gravar(async () => {
      const r = await salvarParametro({
        chave: p.chave,
        unidadeId,
        valor,
        tipoDoPadrao: p.tipo,
        grupo: p.grupo,
        descricao: p.descricao,
      });
      if (r.ok) {
        toast.success(`Valor de ${unidadeNome} gravado.`);
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const faixa =
    p.min !== null || p.max !== null
      ? `entre ${p.min ?? "—"} e ${p.max ?? "—"}`
      : "sem faixa definida pela rede";

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 text-xs">Unidade</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{p.chave}</DialogTitle>
          <DialogDescription>
            Valor só para {unidadeNome} ({faixa}). Padrão da rede: {mostrar(p.valorRede)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={valor} onChange={(e) => setValor(e.target.value)} />
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando}>{gravando ? "Gravando…" : "Gravar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type NivelEditavel = {
  id: string;
  nome: string;
  criterio_conversoes: number;
  multiplicador: number;
  beneficios: string | null;
  ativo: boolean;
};

export function EditarNivel({ n }: { n: NivelEditavel }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(n.nome);
  const [criterio, setCriterio] = useState(String(n.criterio_conversoes));
  const [mult, setMult] = useState(String(n.multiplicador).replace(".", ","));
  const [beneficios, setBeneficios] = useState(n.beneficios ?? "");
  const [ativo, setAtivo] = useState(n.ativo);
  const [gravando, gravar] = useTransition();

  function salvar() {
    gravar(async () => {
      const r = await salvarNivel(n.id, {
        nome,
        criterio: Number(criterio),
        multiplicador: Number(mult.replace(",", ".")),
        beneficios,
        ativo,
      });
      if (r.ok) {
        toast.success("Nível atualizado. Vale no próximo recálculo e para os pontos novos.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 text-xs">Editar</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nível {n.nome}</DialogTitle>
          <DialogDescription>Critério = fechamentos convertidos na janela de 12 meses.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="n-nome">Nome</Label>
            <Input id="n-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="n-crit">Fechamentos</Label>
              <Input id="n-crit" value={criterio} onChange={(e) => setCriterio(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="n-mult">Multiplicador</Label>
              <Input id="n-mult" value={mult} onChange={(e) => setMult(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="n-ben">Benefício de status</Label>
            <Input id="n-ben" value={beneficios} onChange={(e) => setBeneficios(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando}>{gravando ? "Gravando…" : "Gravar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
