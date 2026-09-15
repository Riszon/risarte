"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate, formatBrDateTime, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  COLLECTION_OUTCOMES,
  COLLECTION_OUTCOME_LABELS,
  exigeDataPrometida,
  linkDoWhatsApp,
  precisaDeOutraPessoa,
  type CollectionOutcome,
  type Inadimplente,
} from "@/lib/finance/collection";
import { registerCollectionContact } from "./actions";

export function ListaDeCobranca({
  fila,
  promessasVencidasIds,
}: {
  fila: Inadimplente[];
  /** Quem prometeu e o dia passou — destacado na lista. */
  promessasVencidasIds: string[];
}) {
  const vencidas = new Set(promessasVencidasIds);

  if (fila.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
        Nenhum inadimplente nesta unidade. Quem tem parcela a vencer aparece na
        <Link href="/financeiro/recebiveis" className="mx-1 underline">
          visão geral
        </Link>
        — a vencer não é atraso.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">Paciente</th>
            <th className="px-2 py-2 font-medium">Telefone</th>
            <th className="px-2 py-2 text-right font-medium">Valor devedor</th>
            <th className="px-2 py-2 font-medium">Atraso</th>
            <th className="px-2 py-2 font-medium">Último contato</th>
            <th className="px-2 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {fila.map((p) => (
            <tr
              key={p.clientId}
              className={cn(
                "border-b last:border-0",
                vencidas.has(p.clientId) && "bg-destructive/5"
              )}
            >
              <td className="px-2 py-2">
                <Link
                  href={`/prontuarios/${p.clientId}`}
                  className="hover:underline"
                >
                  {p.cliente}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {p.quantidadeVencida} cobrança
                  {p.quantidadeVencida === 1 ? "" : "s"} vencida
                  {p.quantidadeVencida === 1 ? "" : "s"}
                  {p.aVencerCents > 0 &&
                    ` · ${formatBRL(p.aVencerCents)} ainda a vencer`}
                </span>
              </td>

              <td className="px-2 py-2">
                <Telefone telefone={p.telefone} />
              </td>

              <td className="px-2 py-2 text-right font-semibold tabular-nums text-destructive">
                {formatBRL(p.vencidoCents)}
              </td>

              <td className="px-2 py-2 text-xs tabular-nums">
                {p.diasDoMaisAntigo} dia
                {p.diasDoMaisAntigo === 1 ? "" : "s"}
              </td>

              <td className="px-2 py-2 text-xs">
                {p.ultimoContato ? (
                  <>
                    <span
                      className={cn(
                        vencidas.has(p.clientId) &&
                          "font-medium text-destructive"
                      )}
                    >
                      {COLLECTION_OUTCOME_LABELS[p.ultimoContato.outcome]}
                    </span>
                    {p.ultimoContato.promisedDate && (
                      <span
                        className={cn(
                          "block",
                          vencidas.has(p.clientId)
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {vencidas.has(p.clientId) ? "prometeu para " : "paga em "}
                        {formatBrDate(`${p.ultimoContato.promisedDate}T12:00:00`)}
                        {vencidas.has(p.clientId) && " e não pagou"}
                      </span>
                    )}
                    <span className="block text-muted-foreground">
                      {formatBrDateTime(p.ultimoContato.contactedAt)}
                      {p.ultimoContato.authorName
                        ? ` · ${p.ultimoContato.authorName}`
                        : ""}
                      {p.totalDeContatos > 1
                        ? ` · ${p.totalDeContatos} tentativas`
                        : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    ninguém entrou em contato
                  </span>
                )}
              </td>

              <td className="px-2 py-2 text-right">
                <ContatoDialog pessoa={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ⚠️ SEM TELEFONE, A TELA DIZ ISSO — e com destaque.
 *
 * É exatamente o que impede a cobrança de acontecer, e a correção não é
 * daqui: é alguém abrir a ficha e completar o cadastro. Mostrar um traço
 * discreto faria a pessoa descobrir só na hora de discar.
 */
function Telefone({ telefone }: { telefone: string | null }) {
  const whats = linkDoWhatsApp(telefone);
  if (!telefone || !whats) {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <PhoneOff className="size-3.5" />
        sem telefone no cadastro
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <a
        href={`tel:${telefone.replace(/\D/g, "")}`}
        className="flex items-center gap-1 tabular-nums hover:underline"
      >
        <Phone className="size-3.5 text-muted-foreground" />
        {telefone}
      </a>
      <a
        href={whats}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Abrir conversa no WhatsApp"
        title="Abrir no WhatsApp"
      >
        <MessageCircle className="size-3.5" />
      </a>
    </span>
  );
}

function ContatoDialog({ pessoa }: { pessoa: Inadimplente }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CollectionOutcome>("NAO_ATENDEU");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await registerCollectionContact(pessoa.clientId, formData);
      if (r.ok) {
        toast.success("Contato registrado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 text-xs">
            Registrar contato
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pessoa.cliente}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Deve <strong>{formatBRL(pessoa.vencidoCents)}</strong> em{" "}
          {pessoa.quantidadeVencida} cobrança
          {pessoa.quantidadeVencida === 1 ? "" : "s"}, atraso mais antigo de{" "}
          {pessoa.diasDoMaisAntigo} dia
          {pessoa.diasDoMaisAntigo === 1 ? "" : "s"}.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor={`outcome-${pessoa.clientId}`}>
              O que aconteceu no contato *
            </Label>
            <select
              id={`outcome-${pessoa.clientId}`}
              name="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CollectionOutcome)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {COLLECTION_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {COLLECTION_OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </div>

          {exigeDataPrometida(outcome) && (
            <div>
              <Label htmlFor={`promised-${pessoa.clientId}`}>
                Prometeu pagar em *
              </Label>
              <Input
                id={`promised-${pessoa.clientId}`}
                name="promised_date"
                type="date"
                min={todayInBrazil()}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Quando o dia passar sem pagamento, a pessoa volta destacada na
                lista.
              </p>
            </div>
          )}

          {precisaDeOutraPessoa(outcome) && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {outcome === "JA_PAGOU"
                ? "Confira na Conciliação antes de cobrar de novo — pode ser pagamento ainda não baixado."
                : "Acordo e renegociação não se fecham no telefone: quem decide é o Gerente, em Renegociações."}
            </p>
          )}

          <div>
            <Label htmlFor={`note-${pessoa.clientId}`}>Observação</Label>
            <textarea
              id={`note-${pessoa.clientId}`}
              name="note"
              rows={3}
              placeholder="O que a pessoa falou, o que ficou combinado."
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            O registro não se edita nem se apaga: é a sequência de tentativas
            que prova que a unidade cobrou. Errou? Registre de novo.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Registrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
