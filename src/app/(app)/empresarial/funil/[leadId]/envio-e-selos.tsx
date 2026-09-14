"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, MessageCircle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DISPATCH_CHANNELS,
  DISPATCH_CHANNEL_LABELS,
  DISPATCH_ITEMS,
  DISPATCH_ITEM_LABELS,
  type DispatchChannel,
  type DispatchItem,
} from "@/lib/empresarial/constants";
import {
  faltaParaFechar,
  linkDoWhatsApp,
  montarMensagem,
  moveParaFollowUp,
} from "@/lib/empresarial/envio";
import { formatBrDate, formatBrTime } from "@/lib/dates";
import { registerDispatch, setLeadSeal } from "./actions";

export type EnvioView = {
  id: string;
  channel: DispatchChannel;
  items: DispatchItem[];
  note: string | null;
  sentAt: string;
  authorName: string | null;
};

export function EnvioESelos({
  leadId,
  empresa,
  contato,
  telefone,
  consultor,
  envios,
  contractSignedAt,
  implantationPaidAt,
}: {
  leadId: string;
  empresa: string;
  contato: string | null;
  telefone: string | null;
  consultor: string | null;
  envios: EnvioView[];
  contractSignedAt: string | null;
  implantationPaidAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [itens, setItens] = useState<DispatchItem[]>(["PROPOSAL"]);
  const [canal, setCanal] = useState<DispatchChannel>("WHATSAPP");

  const mensagem = useMemo(
    () => montarMensagem({ empresa, contato, itens, consultor }),
    [empresa, contato, itens, consultor]
  );
  const whatsapp = linkDoWhatsApp(telefone, mensagem);
  const falta = faltaParaFechar({ contractSignedAt, implantationPaidAt });

  function alternar(item: DispatchItem) {
    setItens((atual) =>
      atual.includes(item) ? atual.filter((i) => i !== item) : [...atual, item]
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await registerDispatch(leadId, formData);
      if (r.ok) {
        toast.success(
          moveParaFollowUp(itens)
            ? "Envio registrado. A empresa foi para Follow-up."
            : "Envio registrado."
        );
        form.reset();
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function marcar(seal: "contract" | "implantation", marcado: boolean) {
    startTransition(async () => {
      const r = await setLeadSeal(leadId, seal, marcado);
      if (r.ok) {
        toast.success(marcado ? "Marcado." : "Desmarcado.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">Enviar o pacote para a empresa</p>
            <p className="text-xs text-muted-foreground">
              O sistema <strong>não envia</strong> — quem envia é você. Aqui fica
              o registro do que foi enviado, e a mensagem sai pronta para colar.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label>O que vai junto</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {DISPATCH_ITEMS.map((item) => {
                  const marcado = itens.includes(item);
                  return (
                    <label
                      key={item}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                        marcado ? "border-primary bg-primary/10" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="items"
                        value={item}
                        checked={marcado}
                        onChange={() => alternar(item)}
                        className="size-3.5"
                      />
                      {DISPATCH_ITEM_LABELS[item]}
                    </label>
                  );
                })}
              </div>
              {moveParaFollowUp(itens) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Como a proposta vai junto, registrar o envio move a empresa
                  para <strong>Follow-up</strong>.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sem a proposta, o envio fica registrado mas a empresa
                  permanece na fase atual.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="channel">Por onde foi enviado</Label>
                <select
                  id="channel"
                  name="channel"
                  value={canal}
                  onChange={(e) => setCanal(e.target.value as DispatchChannel)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  {DISPATCH_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {DISPATCH_CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="note">Observação</Label>
                <Input id="note" name="note" />
              </div>
            </div>

            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs font-medium">Mensagem pronta</p>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                {mensagem}
              </pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(mensagem)
                      .then(() => toast.success("Mensagem copiada."))
                      .catch(() => toast.error("Não consegui copiar."));
                  }}
                >
                  Copiar mensagem
                </Button>
                {whatsapp ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    nativeButton={false}
                    render={
                      <a href={whatsapp} target="_blank" rel="noreferrer" />
                    }
                  >
                    <MessageCircle className="mr-1 size-3.5" />
                    Abrir no WhatsApp
                  </Button>
                ) : (
                  // Botão que abre o WhatsApp vazio é pior que botão nenhum:
                  // parece que funcionou.
                  <span className="self-center text-xs text-muted-foreground">
                    Sem telefone no cadastro do lead — preencha para abrir o
                    WhatsApp.
                  </span>
                )}
              </div>
            </div>

            <Button type="submit" size="sm" disabled={isPending}>
              <Send className="mr-1 size-3.5" />
              Registrar envio
            </Button>
          </form>

          {envios.length > 0 && (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto border-t pt-2 text-xs">
              {envios.map((e) => (
                <li key={e.id} className="border-b pb-1 last:border-0">
                  <span className="font-medium">
                    {DISPATCH_CHANNEL_LABELS[e.channel]}
                  </span>{" "}
                  — {e.items.map((i) => DISPATCH_ITEM_LABELS[i]).join(", ")}
                  {e.note ? ` · ${e.note}` : ""}
                  <span className="block text-muted-foreground">
                    {formatBrDate(e.sentAt)} {formatBrTime(e.sentAt)}
                    {e.authorName ? ` · ${e.authorName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card className={falta.length === 0 ? "border-emerald-600/40" : undefined}>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">Follow-up — o que fecha o negócio</p>
            <p className="text-xs text-muted-foreground">
              Só é ganho com <strong>contrato assinado E pagamento
              confirmado</strong>. Um selo sozinho não fecha nada.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Selo
              rotulo="Contrato assinado"
              em={contractSignedAt}
              disabled={isPending}
              onChange={(v) => marcar("contract", v)}
            />
            <Selo
              rotulo="Boleto da implantação pago"
              em={implantationPaidAt}
              disabled={isPending}
              onChange={(v) => marcar("implantation", v)}
            />
          </div>

          {falta.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Falta: {falta.join(" e ")}.
            </p>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Os dois selos estão verdes — a empresa foi para Fechamento (ganho).
              Crie a empresa pelo cartão, no Funil.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Selo({
  rotulo,
  em,
  disabled,
  onChange,
}: {
  rotulo: string;
  em: string | null;
  disabled: boolean;
  onChange: (marcado: boolean) => void;
}) {
  const marcado = Boolean(em);
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border p-2.5 ${
        marcado ? "border-emerald-600/40 bg-emerald-600/5" : ""
      }`}
    >
      <div>
        <p className="text-sm">{rotulo}</p>
        {marcado ? (
          <p className="text-xs text-muted-foreground">
            em {formatBrDate(em!)} {formatBrTime(em!)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">ainda não</p>
        )}
      </div>
      {marcado ? (
        <div className="flex items-center gap-1">
          <Badge className="bg-emerald-600 text-xs text-white">
            <Check className="mr-0.5 size-3" />
            Feito
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={() => onChange(false)}
          >
            Desfazer
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={disabled}
          onClick={() => onChange(true)}
        >
          Marcar
        </Button>
      )}
    </div>
  );
}
