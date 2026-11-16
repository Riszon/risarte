"use client";

/**
 * 4018 (19.32.5 e 19.32.10): a unidade liga as mensalidades pelo Asaas a partir
 * de uma data. Antes, a tela mostra quantos clientes entram agora e quantos
 * esperam a ASA4B (os de recorrência), e a unidade marca "Avisei os clientes e
 * cancelei as assinaturas antigas." (19.34.10: sem isso, a assinatura antiga do
 * painel do Asaas e a mensalidade do riSZon cobrariam o mesmo mês).
 * Nada muda sozinho: até ligar, tudo continua manual.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ligarMensalidades, lerPreviaDasMensalidades, type PreviaDasMensalidades } from "./mensalidades-actions";

export function MensalidadesDaUnidade({ clinicId, clinicName, hoje }: { clinicId: string; clinicName: string; hoje: string }) {
  const router = useRouter();
  const [data, setData] = useState(hoje);
  const [avisei, setAvisei] = useState(false);
  const [previa, setPrevia] = useState<PreviaDasMensalidades | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  useEffect(() => {
    let vivo = true;
    void lerPreviaDasMensalidades(clinicId, data).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPrevia(r.previa);
        setErro(null);
      } else setErro(r.error);
    });
    return () => {
      vivo = false;
    };
  }, [clinicId, data]);

  if (erro) return null;
  if (!previa) return null;
  const ligada = !!previa.ligada_desde;

  function salvar(ligar: boolean) {
    start(async () => {
      const r = await ligarMensalidades(clinicId, ligar ? data : null, ligar ? avisei : false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(ligar ? "Mensalidades pelo Asaas ligadas." : "Mensalidades pelo Asaas desligadas: tudo volta a ser manual.");
      router.refresh();
    });
  }

  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm">
      <h2 className="font-semibold">Mensalidades pelo Asaas — {clinicName}</h2>
      {ligada ? (
        <p className="text-xs">
          Ligadas desde <strong>{previa.ligada_desde!.split("-").reverse().join("/")}</strong>. As mensalidades do PPR+ e da
          Ortodontia em boleto, Pix ou cartão pelo link vão ao Asaas pela janela da rede; as de recorrência esperam a ASA4B.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Desligadas: as mensalidades continuam manuais, como hoje.</p>
      )}
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        <li>PPR+: <strong>{previa.ppr_entram}</strong> cliente(s) entram agora</li>
        <li>PPR+: <strong>{previa.ppr_esperam}</strong> em recorrência esperam a ASA4B</li>
        <li>Ortodontia: <strong>{previa.orto_entram}</strong> cliente(s) entram agora</li>
        <li>Ortodontia: <strong>{previa.orto_esperam}</strong> em recorrência esperam a ASA4B</li>
        <li className="sm:col-span-2">
          <strong>{previa.com_contato}</strong> dos que entram têm e-mail ou celular e vão receber os avisos do Asaas.
        </li>
      </ul>
      {!ligada && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Antes de ligar, cancele no painel do Asaas as assinaturas antigas dos clientes que entram.
        </p>
      )}
      {!ligada && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            A partir de
            <Input type="date" className="h-8 w-40 text-xs" value={data} min={hoje} onChange={(e) => setData(e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={avisei} onChange={(e) => setAvisei(e.target.checked)} />
            Avisei os clientes e cancelei as assinaturas antigas.
          </label>
          <Button size="sm" disabled={isPending || !avisei} onClick={() => salvar(true)}>
            Ligar
          </Button>
        </div>
      )}
      {ligada && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => salvar(false)}>
          Desligar
        </Button>
      )}
    </section>
  );
}
