"use client";

/**
 * 4018 (19.32.2 item 8) — a cobrança de uma mensalidade no Asaas, em qualquer
 * tela de Mensalidades (PPR+, Ortodontia e as origens que vierem): a situação, o
 * link da fatura, "Copiar link" e "Enviar pelo WhatsApp".
 */
import { toast } from "sonner";
import { Copy, MessageCircle } from "lucide-react";

export type CobrancaDaMensalidadeDados = {
  status: string;
  billing_type: string;
  link: string | null;
  linha: string | null;
  pix: string | null;
};

const SITUACAO: Record<string, string> = {
  emitindo: "sendo criada no Asaas",
  emitida: "no Asaas, a pagar",
  vencida: "no Asaas, vencida",
  erro_emissao: "erro no Asaas",
  paga: "paga pelo Asaas",
  liquidada: "paga pelo Asaas",
  cancelada: "cobrança cancelada",
  estornada: "estornada no Asaas",
};
const MEIO: Record<string, string> = { BOLETO: "boleto", PIX: "Pix", CREDIT_CARD: "cartão pelo link" };

export function CobrancaDaMensalidade({ c, telefone, nome }: { c: CobrancaDaMensalidadeDados; telefone?: string | null; nome?: string | null }) {
  const viva = c.status === "emitida" || c.status === "vencida";
  const mensagem = c.link
    ? `Olá${nome ? `, ${nome.split(" ")[0]}` : ""}! Segue o link da sua mensalidade: ${c.link}`
    : "";
  const fone = (telefone ?? "").replace(/\D/g, "");
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      <span className="rounded-full border px-1.5 py-0.5">
        {MEIO[c.billing_type] ?? c.billing_type} · {SITUACAO[c.status] ?? c.status}
      </span>
      {viva && c.link && (
        <>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 hover:border-primary hover:text-primary"
            onClick={() => {
              void navigator.clipboard.writeText(c.link!);
              toast.success("Link copiado.");
            }}
          >
            <Copy className="size-3" />
            Copiar link
          </button>
          <a
            className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 hover:border-primary hover:text-primary"
            href={`https://wa.me/${fone.length >= 10 ? (fone.startsWith("55") ? fone : `55${fone}`) : ""}?text=${encodeURIComponent(mensagem)}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="size-3" />
            WhatsApp
          </a>
        </>
      )}
    </span>
  );
}
