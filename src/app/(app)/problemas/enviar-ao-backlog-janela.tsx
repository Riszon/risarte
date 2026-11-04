"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MODULOS, type Relato } from "@/lib/system-reports";
import { PRIORIDADES, PRIORIDADE_EXPLICA, PRIORIDADE_ROTULO, sugestaoDoRelato, type Prioridade } from "@/lib/backlog";
import { Escolha } from "@/app/(app)/admin/backlog/pecas";
import { categoriasDoBacklog, enviarAoBacklog } from "./enviar-ao-backlog";

const SEM_MODULO = "__sem";

/**
 * "ENVIAR PARA O BACKLOG" (BK4) — ao lado de "Preparar briefing", no relato e
 * na barra do lote. Abre preenchido pelo relato (título, detalhe sem o nome de
 * quem relatou, categoria pelo tipo, prioridade pela gravidade) numa janela
 * EDITÁVEL: o relato é texto livre e pode ter nome de paciente — revise antes
 * de gravar (LGPD). Ou liga a um item que já existe.
 */
export function EnviarAoBacklog({
  relatos,
  aoTerminar,
  className,
}: {
  relatos: Relato[];
  aoTerminar?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pendente, comecar] = useTransition();
  const [tipo, setTipo] = useState<"novo" | "existente">("novo");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [categoria, setCategoria] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("media");
  const [modulo, setModulo] = useState(SEM_MODULO);
  const [existente, setExistente] = useState("");
  const [feito, setFeito] = useState<{ code: string; falhas: string[] } | null>(null);

  function abrir(sim: boolean) {
    setAberto(sim);
    if (!sim) return;
    const s = sugestaoDoRelato(relatos);
    setTipo("novo");
    setTitulo(s.title);
    setDetalhe(s.detail);
    setPrioridade(s.priority);
    setModulo(s.module ?? SEM_MODULO);
    setExistente("");
    setFeito(null);
    comecar(async () => {
      const lista = await categoriasDoBacklog();
      setCategorias(lista);
      setCategoria(lista.includes(s.category) ? s.category : (lista[0] ?? ""));
    });
  }

  function enviar() {
    comecar(async () => {
      const r = await enviarAoBacklog(
        relatos.map((x) => ({ id: x.id, code: x.code, title: x.title, ambiente: x.ambiente, status: x.status })),
        tipo === "existente"
          ? { tipo: "existente", code: existente }
          : {
              tipo: "novo",
              title: titulo,
              detail: detalhe,
              category: categoria,
              priority: prioridade,
              module: modulo === SEM_MODULO ? null : modulo,
            }
      );
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.falhas.length === 0) toast.success(`No backlog: ${r.code}`);
      setFeito({ code: r.code, falhas: r.falhas });
      router.refresh();
    });
  }

  const n = relatos.length;
  return (
    <Dialog open={aberto} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={className}>
            <ListPlus className="mr-1.5 size-3.5" />
            Enviar para o backlog
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Enviar {n === 1 ? relatos[0].code : `${n} relatos`} para o backlog
          </DialogTitle>
          <DialogDescription>
            O relato fica <strong>Em análise</strong> e ligado ao item. Revise o texto: o relato é escrito por
            gente e pode citar paciente — o nome de quem relatou já não vai.
          </DialogDescription>
        </DialogHeader>

        {feito ? (
          <div className="space-y-3 text-sm">
            <p>
              {n === 1 ? "O relato está" : "Os relatos estão"} no backlog como{" "}
              <Link href={`/admin/backlog/${feito.code}`} className="font-medium text-primary hover:underline">
                {feito.code}
              </Link>
              .
            </p>
            {feito.falhas.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 pl-6 dark:bg-amber-950/30">
                {feito.falhas.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setAberto(false);
                  aoTerminar?.();
                }}
              >
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
              {(
                [
                  ["novo", "Criar item novo"],
                  ["existente", "Ligar a um item que já existe"],
                ] as const
              ).map(([v, rotulo]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTipo(v)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5",
                    tipo === v ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>

            {tipo === "existente" ? (
              <div className="space-y-1.5">
                <Label htmlFor="bk-existente">Código do item</Label>
                <Input
                  id="bk-existente"
                  value={existente}
                  onChange={(e) => setExistente(e.target.value.toUpperCase())}
                  placeholder="AP56"
                  className="w-40"
                />
                <p className="text-xs text-muted-foreground">
                  Para vários relatos do mesmo defeito: todos ficam ligados ao mesmo item.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-rel-titulo">Título</Label>
                  <Input id="bk-rel-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-rel-detalhe">Detalhe</Label>
                  <textarea
                    id="bk-rel-detalhe"
                    value={detalhe}
                    onChange={(e) => setDetalhe(e.target.value)}
                    rows={10}
                    className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Categoria</Label>
                    <Escolha
                      rotulo="Categoria"
                      itens={categorias.map((c) => ({ value: c, label: c }))}
                      valor={categoria}
                      aoMudar={setCategoria}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Prioridade</Label>
                    <Escolha
                      rotulo="Prioridade"
                      itens={PRIORIDADES.map((p) => ({ value: p, label: PRIORIDADE_ROTULO[p] }))}
                      valor={prioridade}
                      aoMudar={(v) => setPrioridade(v as Prioridade)}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Módulo</Label>
                    <Escolha
                      rotulo="Módulo"
                      itens={[{ value: SEM_MODULO, label: "Nenhum" }, ...MODULOS.map((m) => ({ value: m.value, label: m.label }))]}
                      valor={modulo}
                      aoMudar={setModulo}
                      className="w-full"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {PRIORIDADE_ROTULO[prioridade]}: {PRIORIDADE_EXPLICA[prioridade]} (sugerida pela gravidade do relato)
                </p>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>
                Cancelar
              </Button>
              <Button
                onClick={enviar}
                disabled={pendente || (tipo === "existente" ? !/^AP\d+$/.test(existente.trim()) : !titulo.trim() || !categoria)}
              >
                {pendente ? "Gravando…" : "Enviar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
