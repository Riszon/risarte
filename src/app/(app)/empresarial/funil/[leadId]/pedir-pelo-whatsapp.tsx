"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
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
import { linkDoWhatsApp } from "@/lib/empresarial/envio";
import { anotacaoDoPedido } from "@/lib/empresarial/pedido-de-informacoes";
import { addLeadActivity } from "../actions";

/** O que a tela do servidor monta para o botão (`pendenciasDoPedido` + a mensagem). */
export type PedidoDeInformacoes = {
  perguntas: string[];
  nossas: string[];
  telefone: string | null;
  mensagem: string;
};

/**
 * PEDIR À EMPRESA O QUE FALTA, PELO WHATSAPP (dono, 09/11/2026).
 *
 * O sistema não envia nada: abre a conversa com a mensagem pronta, e quem
 * aperta enviar no WhatsApp é o consultor. Ao abrir, fica uma anotação no
 * Histórico — semanas depois, dá para saber o que já foi pedido.
 */
export function PedirPeloWhatsApp({
  leadId,
  pedido,
}: {
  leadId: string;
  pedido: PedidoDeInformacoes;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(pedido.mensagem);
  if (pedido.perguntas.length === 0) return null;

  // Botão que abre o WhatsApp vazio é pior que botão nenhum: sem telefone, a
  // janela diz onde cadastrar.
  const link = linkDoWhatsApp(pedido.telefone, texto);

  function registrar() {
    void addLeadActivity(leadId, "NOTE", anotacaoDoPedido(pedido.perguntas)).then((r) => {
      if (r.ok) toast.success("Pedido anotado no Histórico.");
      else toast.error("O WhatsApp abriu, mas a anotação no Histórico não foi gravada.");
    });
    setAberto(false);
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (v) setTexto(pedido.mensagem);
      }}
    >
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <MessageCircle className="mr-1.5 size-4" />
        Pedir o que falta pelo WhatsApp
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pedir à empresa o que falta</DialogTitle>
          <DialogDescription>
            A mensagem abre no WhatsApp para você conferir e enviar. Pode
            ajustar o texto antes.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={12}
          className="w-full min-w-0 rounded-md border border-input bg-transparent p-2 text-sm"
          aria-label="Mensagem"
        />

        {pedido.nossas.length > 0 && (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            <strong>Falta também, e é com você</strong> (não vai na mensagem):{" "}
            {pedido.nossas.join(", ")}.
          </p>
        )}

        {link ? (
          <Button
            nativeButton={false}
            render={<a href={link} target="_blank" rel="noopener noreferrer" onClick={registrar} />}
          >
            <MessageCircle className="mr-1.5 size-4" />
            Abrir no WhatsApp
          </Button>
        ) : (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
            Não há telefone para abrir o WhatsApp. Cadastre o telefone de quem
            assina no passo <strong>Dados do contrato</strong> da proposta, ou o
            telefone do contato no cadastro da empresa.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
