"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { cobrancasParaEstornoDoDistrato, pedirDevolucaoDoDistrato, type DistratoLido } from "@/app/(app)/financeiro/cobrancas-automaticas/distrato-actions";

const TIPOS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const SITUACAO: Record<string, string> = {
  pedida: "aguardando o Financeiro",
  autorizada: "autorizada",
  negada: "negada",
  paga_pelo_asaas: "paga pelo estorno do Asaas",
};

/**
 * 4020 (19.35.13, ajuste 1): a devolução do distrato por Pix da conta da
 * unidade. O Gerente pede, com o termo assinado anexado; o Financeiro da
 * Franqueadora ou o Admin Master autorizam, e vira conta a pagar 1.9.03. O
 * recebimento original não é desfeito: a taxa da rede continua devida.
 */
export function DevolucaoDoDistrato({ d, clinicId }: { d: DistratoLido; clinicId: string }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  // 4020a: o estorno pelo Asaas primeiro (numa cobrança paga), o Pix da unidade como alternativa.
  const [cobrancas, setCobrancas] = useState<{ id: string; valor: number; pagaEm: string | null; meio: string }[]>([]);
  const [metodo, setMetodo] = useState<"estorno_asaas" | "pix_unidade">("pix_unidade");
  const [cobranca, setCobranca] = useState("");
  useEffect(() => {
    cobrancasParaEstornoDoDistrato(d.id).then((cs) => {
      setCobrancas(cs);
      if (cs.length) {
        setMetodo("estorno_asaas");
        setCobranca(cs[0].id);
      }
    });
  }, [d.id]);
  const jaPedido = d.devolucoes.filter((x) => x.situacao !== "negada").reduce((t, x) => t + x.valor, 0);
  const falta = Math.max(0, d.acerto.unidade_devolve - jaPedido);

  if (d.acerto.unidade_devolve <= 0) return null;

  function pedir() {
    const cents = parseBRLToCents(valor) ?? 0;
    if (cents <= 0) return toast.error("Informe o valor a devolver.");
    if (cents > falta) return toast.error(`O valor passa do que falta devolver (${formatBRL(falta)}).`);
    if (motivo.trim().length < 5) return toast.error("Escreva o motivo.");
    if (!arquivo) return toast.error("Anexe o termo de distrato assinado.");
    if (!TIPOS[arquivo.type]) return toast.error("Envie PDF ou imagem (PNG, JPG, WEBP).");
    if (arquivo.size > 10 * 1024 * 1024) return toast.error("O arquivo passa de 10 MB.");
    start(async () => {
      const path = `${clinicId}/distrato-${d.id}/${crypto.randomUUID()}.${TIPOS[arquivo.type]}`;
      const { error } = await createClient().storage.from("devolucoes").upload(path, arquivo, { contentType: arquivo.type });
      if (error) return void toast.error("Não foi possível enviar o termo. Tente de novo.");
      const r = await pedirDevolucaoDoDistrato({
        cancellationId: d.id,
        amountCents: cents,
        reason: motivo.trim(),
        termPath: path,
        termName: arquivo.name.slice(0, 120),
        method: metodo,
        chargeId: metodo === "estorno_asaas" ? cobranca : null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Pedido enviado para a autorização do Financeiro da Franqueadora.");
      setValor("");
      setMotivo("");
      setArquivo(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs">
      <p className="text-sm font-semibold">Devolução ao paciente: {formatBRL(d.acerto.unidade_devolve)}</p>
      <p className="text-muted-foreground">
        Pelo estorno no Asaas (numa cobrança paga pelo Asaas) ou por Pix da conta da unidade. O recebimento original não é
        desfeito, e a taxa da rede continua devida (a dispensa é à mão, do Financeiro da Franqueadora ou do Admin Master).
      </p>
      {d.devolucoes.map((x) => (
        <p key={x.id}>
          {formatBRL(x.valor)} — {SITUACAO[x.situacao] ?? x.situacao}
          {x.nota ? `: ${x.nota}` : ""}
        </p>
      ))}
      {d.pode_pedir_devolucao && falta > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={`Valor (falta ${formatBRL(falta)})`}
              className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
            />
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo"
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {cobrancas.length > 0 && <option value="estorno_asaas">Estorno pelo Asaas (primeiro)</option>}
              <option value="pix_unidade">Pix da conta da unidade</option>
            </select>
            {metodo === "estorno_asaas" && (
              <select value={cobranca} onChange={(e) => setCobranca(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                {cobrancas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.meio} de {formatBRL(c.valor)}
                    {c.pagaEm ? ` pago em ${c.pagaEm.slice(0, 10).split("-").reverse().join("/")}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          {metodo === "estorno_asaas" && (
            <p className="text-[11px] text-muted-foreground">
              Autorizado pelo Financeiro, o estorno vai ao Asaas na hora. No cartão, ele sai na hora e não pode ser desfeito.
            </p>
          )}
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Termo de distrato assinado (PDF ou imagem)</span>
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
          <Button size="sm" className="h-7 text-xs" disabled={ocupado} onClick={pedir}>
            Pedir a devolução
          </Button>
        </div>
      )}
    </div>
  );
}
