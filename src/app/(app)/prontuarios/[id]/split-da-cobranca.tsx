"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, MessageCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { linkDoWhatsApp } from "@/lib/empresarial/envio";
import { lerSplitDaCobranca, pedirEstorno, type SplitDaCobranca } from "./estorno-actions";

/**
 * ASA3, entrega 2 (4009): na cobrança da ficha, QUANDO o split foi atualizado
 * e por quê (ajuste 7), e o ESTORNO (18.7.1): o pedido nasce aqui; a
 * autorização é no Asaas, pelo titular, com o código que ele recebe. O riSZon
 * nunca pede, recebe nem guarda esse código.
 */

const MOTIVO: Record<string, string> = {
  taxa: "taxa",
  campanha: "campanha",
  destino: "destino",
  tarifa: "tarifa do Asaas",
  split_habilitado: "split habilitado",
  diaria: "virada do dia",
  manual: "atualizar agora",
  bloqueio: "bloqueio do Asaas",
};
const RESULTADO: Record<string, string> = {
  atualizado: "split atualizado",
  acrescentado: "split acrescentado",
  removido: "split retirado",
  fora_da_janela: "cartão fora da janela do Asaas (mantido)",
  teto: "split mantido (não coube no líquido)",
  reduzido_bloqueio: "split reduzido (bloqueio do Asaas)",
};

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success("Link copiado.");
  } catch {
    toast.error("Não foi possível copiar.");
  }
}

export function SplitDaCobranca({
  clientId,
  chargeId,
  paga,
  meio,
  payerName,
  payerPhone,
}: {
  clientId: string;
  chargeId: string;
  paga: boolean;
  meio: string | null;
  payerName: string | null;
  payerPhone: string | null;
}) {
  const router = useRouter();
  const [dados, setDados] = useState<SplitDaCobranca | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, start] = useTransition();

  useEffect(() => {
    let vivo = true;
    lerSplitDaCobranca(chargeId).then((d) => vivo && setDados(d));
    return () => {
      vivo = false;
    };
  }, [chargeId]);

  if (!dados) return null;
  const boleto = meio === "BOLETO";
  const celular = dados.boleto?.celular ?? null;
  const celularFormatado = celular ? celular.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3") : null;
  // 18.7.7: no boleto, sem o termo declarado ou sem celular válido, não sai pelo riSZon.
  const boletoBloqueado = boleto && (!dados.boleto?.termoDeclarado || !celular);
  const link = dados.refund?.status === "pedido" ? dados.refund.request_url : null;
  const wa = link
    ? linkDoWhatsApp(
        payerPhone,
        `Olá${payerName ? `, ${payerName.split(" ")[0]}` : ""}! Para receber a devolução do pagamento, informe seus dados bancários neste link seguro do Asaas: ${link}`
      )
    : null;

  return (
    <div className="space-y-1">
      {dados.updates.length > 0 && (
        <p className="text-muted-foreground">
          Split:{" "}
          {dados.updates
            .slice(0, 3)
            .map(
              (u) =>
                `${new Date(u.at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} — ${RESULTADO[u.outcome] ?? u.outcome} (${u.reasons
                  .map((x) => MOTIVO[x] ?? x)
                  .join(", ")})`
            )
            .join(" · ")}
          {dados.naFila && " · esperando atualizar"}
        </p>
      )}
      {!dados.updates.length && dados.naFila && <p className="text-muted-foreground">Split esperando atualizar (taxa mudou).</p>}

      {dados.refundState === "aguardando_autorizacao" && (
        <p className="rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900">
          <strong>Estorno aguardando autorização.</strong> Quem tem o acesso da conta Asaas da unidade precisa autorizar no
          Asaas (painel ou aplicativo), com o código que o Asaas manda. O riSZon não pede esse código. Para desistir,
          cancele no painel do Asaas ou não autorize.
        </p>
      )}
      {dados.refundState === "aguardando_pagador" && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900">
          <p>
            <strong>Estorno aguardando o pagador.</strong> No boleto, quem pagou informa os dados bancários direto no Asaas,
            pelo link abaixo. O riSZon não recebe esses dados.
          </p>
          {link && (
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copiar(link)}>
                <Copy className="mr-1 size-3" /> Copiar link
              </Button>
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 hover:bg-muted">
                  <MessageCircle className="size-3" /> Enviar pelo WhatsApp
                </a>
              )}
            </span>
          )}
        </div>
      )}
      {dados.refund && dados.refund.status !== "pedido" && (
        <p className="text-muted-foreground">
          Estorno {dados.refund.status === "concluido" ? "concluído" : dados.refund.status}
          {dados.refund.status_note ? ` (${dados.refund.status_note})` : ""} — pedido em{" "}
          {new Date(dados.refund.requested_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}: “{dados.refund.reason}”.
        </p>
      )}

      {paga && dados.podePedirEstorno && (
        <span className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={boletoBloqueado} onClick={() => setAbrir(true)}>
            <Undo2 className="mr-1 size-3" /> Pedir estorno
          </Button>
          {boleto && !dados.boleto?.termoDeclarado && (
            <span className="text-muted-foreground">
              O estorno de boleto pede o termo de privacidade declarado pelo Admin Master. Até lá, faça no painel do Asaas.
            </span>
          )}
          {boleto && dados.boleto?.termoDeclarado && !celular && (
            <span className="text-muted-foreground">
              Para estornar boleto, o Asaas exige o celular do pagador. Cadastre um celular válido na ficha
              {payerName ? ` (${payerName})` : ""} antes de pedir.
            </span>
          )}
        </span>
      )}

      <Dialog open={abrir} onOpenChange={setAbrir}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir o estorno total</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {boleto ? (
              <>
                <p>
                  O Asaas gera um <strong>link para o pagador</strong> informar os dados bancários e enviar os documentos. O
                  dinheiro só volta depois disso. O riSZon não recebe esses dados.
                </p>
                <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  Para isso, o riSZon envia ao Asaas o celular do pagador{payerName ? ` (${payerName})` : ""}:{" "}
                  <strong>{celularFormatado}</strong>. O Asaas vai mandar um <strong>SMS</strong> a esse número com o link.
                  Os avisos de cobrança do pagador continuam como estão.
                </p>
              </>
            ) : (
              <p>
                O pedido vai ao Asaas e fica <strong>aguardando a autorização</strong> de quem tem o acesso da conta da
                unidade, com o código que o Asaas manda por SMS ou aplicativo. <strong>O riSZon nunca pede esse código.</strong>
              </p>
            )}
            <p className="text-muted-foreground">
              Quando o estorno for concluído, a baixa é desfeita e a taxa da rede continua devida pela unidade (pode ser
              dispensada pelo Financeiro).
            </p>
            <textarea
              className="min-h-20 w-full rounded-md border bg-transparent p-2"
              placeholder="Motivo (obrigatório)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={pendente}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrir(false)} disabled={pendente}>
              Voltar
            </Button>
            <Button
              disabled={pendente || motivo.trim().length < 5}
              onClick={() =>
                start(async () => {
                  const r = await pedirEstorno({ clientId, chargeId, motivo });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  setAbrir(false);
                  setMotivo("");
                  toast.success(
                    r.estado === "aguardando_pagador"
                      ? "Pedido feito. Envie o link ao pagador."
                      : r.estado === "concluido"
                        ? "Estorno concluído no Asaas."
                        : "Pedido feito. Agora autorize no Asaas com o código que você receber."
                  );
                  setDados(await lerSplitDaCobranca(chargeId));
                  router.refresh();
                })
              }
            >
              {pendente ? "Pedindo…" : "Pedir estorno"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
