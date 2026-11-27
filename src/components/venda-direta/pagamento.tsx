"use client";

// VD3-3 — o pagamento pelo Asaas DENTRO da janela: a cobrança da vez em
// destaque (o QR do Pix desenhado na tela a partir do copia e cola guardado,
// ou o link do boleto/cartão), o envio pelo WhatsApp, e a conferência a cada
// poucos segundos — pagou, a janela relê a venda e a caixa fica verde.
// Decisões P1–P3 em docs/comercial/VENDA-DIRETA-V3-PLANO.md §8.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil } from "@/lib/dates";
import { whatsappLink } from "@/lib/whatsapp";
import {
  cobrancaDaVez,
  cobrancaParaNascer,
  esperandoOAsaas,
  semCobrancaOQueFazer,
  type EscolhaDoCartao,
} from "@/lib/venda-direta-caixa";
import { gerarCobrancaDaVez } from "@/app/(app)/comercial/venda-direta/caixa-actions";
import { formatBrDateTime } from "@/lib/dates";
import { lerCobrancasDaVenda, registrarEnvio } from "@/app/(app)/comercial/cobrancas-da-venda-actions";
import { CobrancasDaVenda } from "@/components/commercial/cobrancas-da-venda";
import type { CobrancasDaVenda as Dados, ParcelaDaVenda } from "@/lib/asaas/cobrancas-da-venda";

/** O Asaas grava o meio em maiúsculas (`PIX`); a parcela, em minúsculas. */
const ehPix = (meio: string | null | undefined) => (meio ?? "").toLowerCase() === "pix";

/** De quanto em quanto tempo a janela pergunta se o pagamento caiu. */
const ESPERA_MS = 5000;
/** Por quanto tempo espera a cobrança NASCER depois da assinatura (24 × 5 s = 2 min). */
const MAX_ESPERA_DO_NASCIMENTO = 24;

function QrDoPix({ payload }: { payload: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((u) => vivo && setSrc(u))
      .catch(() => vivo && setSrc(null));
    return () => {
      vivo = false;
    };
  }, [payload]);
  if (!src) return <div className="mx-auto size-48 animate-pulse rounded-lg bg-muted" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora (data URL), não arquivo
  return <img src={src} alt="QR do Pix desta cobrança" className="mx-auto size-48 rounded-lg border bg-white p-1" />;
}

export function PagamentoPeloAsaas({
  saleId,
  clientPhone,
  clientName,
  atualizar,
  pronta,
  automatica,
  debito,
  escolha,
}: {
  saleId: string;
  clientPhone: string | null;
  clientName: string;
  /** Relê a venda (a caixa Pagamento fica verde quando a baixa entra). */
  atualizar: () => Promise<void>;
  /** 4029: a unidade cobra pelo Asaas ("Pronta" na Central). */
  pronta: boolean;
  /** 4029: a criação automática está ligada (a cobrança nasce sozinha na assinatura). */
  automatica: boolean;
  /** 4029: a marca do débito da unidade na Central. */
  debito: "habilitado" | "desabilitado" | null;
  /** 4029: o combinado no cartão à vista (nulo nos outros meios). */
  escolha: EscolhaDoCartao | null;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [lido, setLido] = useState(false);
  const pagosAntes = useRef<number | null>(null);
  const [voltas, setVoltas] = useState(0);
  const [gerando, setGerando] = useState(false);
  const [erroAoGerar, setErroAoGerar] = useState<string | null>(null);

  const aplicar = useCallback(
    async (d: Dados | null) => {
      setLido(true);
      // Leitura que falhou (o banco demorou, a rede caiu): fica o que já estava
      // na tela e a janela segue conferindo. Visto no teste de 17/11/2026: a
      // leitura estourou o tempo bem na hora da baixa, o QR sumiu e a janela
      // parou de perguntar.
      if (!d) return;
      setDados(d);
      // Uma parcela a mais paga desde a última leitura: a baixa entrou.
      const pagas = (d?.parcelas ?? []).filter((p) => p.situacao_parcela === "paga").length;
      if (pagosAntes.current !== null && pagas > pagosAntes.current) await atualizar();
      pagosAntes.current = pagas;
    },
    [atualizar]
  );
  const carregar = useCallback(async () => {
    await aplicar(await lerCobrancasDaVenda({ directSaleId: saleId }).catch(() => null));
  }, [saleId, aplicar]);

  useEffect(() => {
    let vivo = true;
    lerCobrancasDaVenda({ directSaleId: saleId })
      .catch(() => null)
      .then((d) => {
        if (vivo) void aplicar(d);
      });
    return () => {
      vivo = false;
    };
  }, [saleId, aplicar]);

  const parcelas = dados?.parcelas ?? [];
  // Confere enquanto a cobrança espera o pagamento — ou, logo depois da
  // assinatura, enquanto ela ainda nasce (por até 2 minutos).
  // 4029: só espera quando a cobrança VAI nascer (a automática ligada). Com ela
  // desligada — ou depois da espera — a janela oferece "Gerar a cobrança agora".
  const semCobranca = cobrancaParaNascer(parcelas, todayInBrazil())
    ? semCobrancaOQueFazer({ pronta, automatica, voltas, maxVoltas: MAX_ESPERA_DO_NASCIMENTO })
    : null;
  const nascendo = semCobranca === "esperar";
  const esperando = esperandoOAsaas(parcelas) || nascendo;
  useEffect(() => {
    if (!esperando) return;
    const id = setInterval(() => {
      setVoltas((v) => v + 1);
      void carregar();
    }, ESPERA_MS);
    return () => clearInterval(id);
  }, [esperando, carregar]);

  async function enviar(p: ParcelaDaVenda, canal: "copiar_link" | "whatsapp" | "copiar_pix" | "linha_digitavel") {
    const c = p.cobranca;
    if (!c) return;
    if (canal === "whatsapp") {
      const valor = formatBRL(c.valor);
      const texto =
        ehPix(c.meio) && c.pix
          ? `Olá, {nome}! Segue o Pix de ${valor} (copia e cola):\n\n${c.pix}${c.link ? `\n\nOu pague pelo link: ${c.link}` : ""}`
          : `Olá, {nome}! Segue o link para pagar ${valor}: ${c.link ?? ""}`;
      const url =
        whatsappLink(clientPhone, texto, clientName) ??
        `https://wa.me/?text=${encodeURIComponent(texto.replace(/\{nome\}/g, clientName.split(/\s+/)[0] ?? ""))}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      const texto = canal === "copiar_link" ? c.link : canal === "copiar_pix" ? c.pix : c.linha;
      if (!texto) return;
      try {
        await navigator.clipboard.writeText(texto);
        toast.success(canal === "copiar_pix" ? "Pix copia e cola copiado." : canal === "copiar_link" ? "Link copiado." : "Linha digitável copiada.");
      } catch {
        toast.error("Não foi possível copiar. Selecione e copie à mão.");
        return;
      }
    }
    await registrarEnvio(c.id, canal);
  }

  async function gerar() {
    setGerando(true);
    setErroAoGerar(null);
    const r = await gerarCobrancaDaVez(saleId).catch(() => ({ ok: false as const, error: "Não foi possível gerar a cobrança. Tente de novo." }));
    if (!r.ok) setErroAoGerar(r.error ?? "Não foi possível gerar a cobrança.");
    await carregar();
    setGerando(false);
  }

  if (!lido) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Lendo a cobrança…
      </p>
    );
  }
  if (!dados || parcelas.length === 0) return null;

  const daVez = cobrancaDaVez(parcelas);
  const criando = !daVez && (nascendo || parcelas.some((p) => p.cobranca?.status === "emitindo"));
  const c = daVez?.cobranca ?? null;
  const emitindo = parcelas.some((p) => p.cobranca?.status === "emitindo");
  const oferecerGerar = !daVez && !emitindo && semCobranca === "gerar";
  const comErro = parcelas.find((p) => !p.parcelado && p.cobranca?.status === "erro_emissao");

  return (
    <div className="space-y-2">
      {criando && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Criando a cobrança no Asaas…
        </p>
      )}
      {oferecerGerar && (
        <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-xs text-amber-900">
            {automatica
              ? "A cobrança não nasceu sozinha."
              : "Nesta unidade a cobrança não nasce sozinha (a criação automática está desligada)."}{" "}
            Gere agora para ter o link de pagamento.
          </p>
          <Button className="h-10 w-full" disabled={gerando} onClick={gerar}>
            {gerando ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            {gerando ? "Gerando a cobrança…" : "Gerar a cobrança agora"}
          </Button>
          {erroAoGerar && <p className="text-xs font-medium text-rose-700">{erroAoGerar}</p>}
        </div>
      )}
      {!daVez && !oferecerGerar && comErro && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
          A cobrança não saiu no Asaas. Abra &ldquo;Todas as cobranças da venda&rdquo; (ou a aba Financeiro da ficha) e
          use &ldquo;Tentar de novo&rdquo;.
        </p>
      )}
      {daVez && c && (
        <div className="space-y-2 rounded-lg border bg-background p-2">
          <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {parcelas.length > 1 ? `Parcela ${daVez.seq} · ` : ""}
              {c.status === "vencida" ? "Vencida" : "Aguardando o pagamento"}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{formatBRL(c.valor)}</span>
          </p>
          {escolha && (
            <p className="text-xs">
              Combinado: <strong>{escolha === "debito" ? "cartão de débito" : "cartão de crédito à vista"}</strong>. Na
              fatura, o paciente escolhe {escolha === "debito" ? "“Cartão de débito”" : "“Cartão de crédito”"}.
            </p>
          )}
          {escolha === "debito" && debito !== "habilitado" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900">
              O débito {debito === "desabilitado" ? "está marcado como desabilitado" : "ainda não foi conferido"} no Asaas
              desta unidade: a fatura pode oferecer só o crédito.
            </p>
          )}
          {ehPix(c.meio) && c.pix && <QrDoPix payload={c.pix} />}
          <div className="grid gap-1.5">
            {c.pix && (
              <Button variant="outline" className="h-9 w-full" onClick={() => enviar(daVez, "copiar_pix")}>
                <Copy className="mr-1 size-4" /> Copiar Pix
              </Button>
            )}
            {c.link && !ehPix(c.meio) && (
              <Button className="h-10 w-full" onClick={() => window.open(c.link!, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="mr-1 size-4" /> Abrir o link para pagar
              </Button>
            )}
            {c.linha && (
              <Button variant="outline" className="h-9 w-full" onClick={() => enviar(daVez, "linha_digitavel")}>
                <Copy className="mr-1 size-4" /> Linha digitável
              </Button>
            )}
            {(c.link || c.pix) && (
              <Button variant="outline" className="h-9 w-full" onClick={() => enviar(daVez, "whatsapp")}>
                <MessageCircle className="mr-1 size-4" /> Enviar por WhatsApp
              </Button>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Aguardando o pagamento ·{" "}
            {daVez.ultimo_envio
              ? `link enviado em ${formatBrDateTime(daVez.ultimo_envio.quando)}`
              : c.enviada_pelo_asaas_em
                ? "aviso enviado pelo Asaas (e-mail/SMS)"
                : "link ainda não enviado"}
            . Pagou, a venda conclui sozinha.
          </p>
        </div>
      )}
      {(parcelas.length > 1 || dados.parcelamento || dados.boletos || comErro) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Todas as cobranças da venda</summary>
          <div className="mt-2">
            {/* Relida quando uma cobrança muda (nasce, é paga). */}
            <CobrancasDaVenda key={parcelas.map((p) => p.cobranca?.status ?? "-").join("|")} directSaleId={saleId} />
          </div>
        </details>
      )}
    </div>
  );
}
