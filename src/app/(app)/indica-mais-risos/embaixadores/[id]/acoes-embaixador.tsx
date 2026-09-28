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
import { formatBRL } from "@/lib/pricing";
import { formatCpf, formatPhone } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { EMBAIXADOR_STATUS_LABEL, type EmbaixadorStatus } from "@/lib/indica/rotulos";
import { ajustarPontos, definirStatusEmbaixador, linkDoPortal, solicitarResgate } from "../actions";

/** Link pessoal (/i/CÓDIGO) para copiar, e o link do portal pelo WhatsApp. */
export function LinksDoEmbaixador({ embaixadorId, linkPessoal }: { embaixadorId: string; linkPessoal: string }) {
  const [aberto, setAberto] = useState(false);
  const [portal, setPortal] = useState<{ link: string; whatsapp: string | null } | null>(null);
  const [gerando, gerar] = useTransition();

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) setPortal(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline">Links</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Links do Embaixador</DialogTitle>
          <DialogDescription>
            O link pessoal é o convite que ele manda aos amigos. O do portal é o acesso dele ao saldo e aos
            prêmios (sem senha; gerar outro invalida o anterior).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Link pessoal (convite)</Label>
            <div className="mt-1 flex gap-2">
              <Input readOnly value={linkPessoal} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(linkPessoal).then(() => toast.success("Link copiado."))}
              >
                Copiar
              </Button>
            </div>
          </div>
          <div className="space-y-2 border-t pt-3">
            <Label>Portal do Embaixador</Label>
            {portal ? (
              <>
                <Input readOnly value={portal.link} className="font-mono text-xs" />
                {portal.whatsapp ? (
                  <Button className="w-full" nativeButton={false} render={<a href={portal.whatsapp} target="_blank" rel="noopener noreferrer" />}>
                    Enviar pelo WhatsApp do Embaixador
                  </Button>
                ) : (
                  <p className="text-xs text-destructive">O cadastro não tem telefone: copie o link e envie de outro jeito.</p>
                )}
              </>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                disabled={gerando}
                onClick={() =>
                  gerar(async () => {
                    const r = await linkDoPortal(embaixadorId);
                    if (r.ok) setPortal({ link: r.link, whatsapp: r.whatsapp });
                    else toast.error(r.error);
                  })
                }
              >
                {gerando ? "Gerando…" : "Gerar link do portal"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const textareaClass = "mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";

/** Ajuste manual: só gestor, motivo obrigatório, fica na auditoria. */
export function AjusteDialog({ embaixadorId, disponivel }: { embaixadorId: string; disponivel: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [quantia, setQuantia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [gravando, gravar] = useTransition();
  const n = Number(quantia);

  function salvar() {
    gravar(async () => {
      const r = await ajustarPontos(embaixadorId, n, motivo);
      if (r.ok) {
        toast.success("Ajuste lançado no extrato.");
        setAberto(false);
        setQuantia("");
        setMotivo("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline">Ajuste manual</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste manual de Riso Coins</DialogTitle>
          <DialogDescription>
            Positivo credita, negativo debita (até o disponível: {disponivel}). O ajuste vira uma
            linha nova no extrato, com o motivo, e aparece na auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="quantia">Riso Coins *</Label>
            <Input id="quantia" inputMode="numeric" value={quantia} onChange={(e) => setQuantia(e.target.value)} placeholder="ex.: 100 ou -50" />
          </div>
          <div>
            <Label htmlFor="motivo-ajuste">Motivo *</Label>
            <textarea id="motivo-ajuste" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={textareaClass} />
          </div>
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando || !Number.isInteger(n) || n === 0 || motivo.trim().length < 5}>
              {gravando ? "Lançando…" : "Lançar ajuste"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Suspender, reativar ou encerrar. */
export function SituacaoDialog({ embaixadorId, atual }: { embaixadorId: string; atual: EmbaixadorStatus }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState<EmbaixadorStatus>(atual === "ativo" ? "suspenso" : "ativo");
  const [motivo, setMotivo] = useState("");
  const [gravando, gravar] = useTransition();

  function salvar() {
    gravar(async () => {
      const r = await definirStatusEmbaixador(embaixadorId, status, motivo);
      if (r.ok) {
        toast.success(`Situação: ${EMBAIXADOR_STATUS_LABEL[status]}.`);
        setAberto(false);
        setMotivo("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline">Mudar situação</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Situação no programa</DialogTitle>
          <DialogDescription>
            Suspenso não indica nem resgata; o saldo fica guardado. Encerrado sai do programa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <select value={status} onChange={(e) => setStatus(e.target.value as EmbaixadorStatus)} className={selectClass}>
            {(["ativo", "suspenso", "encerrado"] as const)
              .filter((s) => s !== atual)
              .map((s) => (
                <option key={s} value={s}>
                  {EMBAIXADOR_STATUS_LABEL[s]}
                </option>
              ))}
          </select>
          <div>
            <Label htmlFor="motivo-situacao">Motivo *</Label>
            <textarea id="motivo-situacao" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={textareaClass} />
          </div>
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando || motivo.trim().length < 5}>
              {gravando ? "Gravando…" : "Confirmar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type ItemParaResgate = {
  id: string;
  nome: string;
  tipo: string;
  custo: number;
  valorCentavos: number | null;
  estoque: number | null;
  bloqueio: string | null;
};

/** Novo resgate pedido pela equipe em nome do Embaixador. */
export function ResgateDialog({
  embaixadorId,
  disponivel,
  itens,
  unidades,
  limiteAprovacao,
}: {
  embaixadorId: string;
  disponivel: number;
  itens: ItemParaResgate[];
  unidades: { id: string; name: string }[];
  limiteAprovacao: number | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [unidadeId, setUnidadeId] = useState(unidades.length === 1 ? unidades[0].id : "");
  const [ceder, setCeder] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [gravando, gravar] = useTransition();
  const item = itens.find((i) => i.id === itemId) ?? null;

  function salvar() {
    if (!itemId) return;
    gravar(async () => {
      const r = await solicitarResgate({
        embaixadorId,
        itemId,
        unidadeId,
        cederPara: ceder ? { nome, cpf, telefone } : null,
      });
      if (r.ok) {
        toast.success(
          r.status === "solicitado"
            ? `Resgate ${r.codigo} pedido: aguarda a aprovação do gestor. Os pontos já estão reservados.`
            : `Resgate ${r.codigo} aprovado. Entregue em Resgates.`
        );
        setAberto(false);
        setItemId(null);
        setCeder(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm">Novo resgate</Button>} />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo resgate</DialogTitle>
          <DialogDescription>
            Saldo disponível: {disponivel} Riso Coins. O resgate debita só o custo do item.
            {limiteAprovacao !== null && ` Acima de ${limiteAprovacao}, o gestor aprova.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {itens.length === 0 && (
              <li className="text-sm text-muted-foreground">O catálogo está vazio. Cadastre itens em Catálogo.</li>
            )}
            {itens.map((i) => {
              const semSaldo = i.custo > disponivel;
              const travado = semSaldo || Boolean(i.bloqueio);
              return (
                <li key={i.id}>
                  <label
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      travado ? "opacity-60" : "cursor-pointer hover:bg-muted/50",
                      itemId === i.id && "border-primary bg-primary/5"
                    )}
                  >
                    <input type="radio" name="item" disabled={travado} checked={itemId === i.id} onChange={() => setItemId(i.id)} />
                    <span className="flex-1">
                      <span className="font-medium">{i.nome}</span>
                      {i.valorCentavos ? <span className="text-muted-foreground"> · {formatBRL(i.valorCentavos)}</span> : null}
                      <span className="block text-xs text-muted-foreground">
                        {i.bloqueio ?? (semSaldo ? "saldo insuficiente" : i.estoque !== null ? `estoque: ${i.estoque}` : "")}
                      </span>
                    </span>
                    <span className="font-mono text-sm">{i.custo}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {unidades.length > 1 && (
            <div>
              <Label htmlFor="unidade-resgate">Unidade que entrega *</Label>
              <select id="unidade-resgate" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className={selectClass}>
                <option value="">Escolha a unidade</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ceder} onChange={(e) => setCeder(e.target.checked)} />
            Ceder o prêmio para outra pessoa
          </label>
          {ceder && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="ced-nome">Nome de quem recebe *</Label>
                <Input id="ced-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ced-cpf">CPF *</Label>
                <Input id="ced-cpf" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="ced-tel">Telefone *</Label>
                <Input id="ced-tel" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Riso Coins não se transferem; o prêmio resgatado, sim.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando || !item || !unidadeId}>
              {gravando ? "Pedindo…" : item ? `Resgatar por ${item.custo} Riso Coins` : "Escolha um item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
