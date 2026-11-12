"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AVISOS_DA_REGUA, type AvisoDaRegua } from "@/lib/asaas/regua";
import { cn } from "@/lib/utils";
import { declararTermo, ligarReguaDaUnidade, salvarRegua } from "./regua-actions";

/**
 * A RÉGUA DA REDE (ASA2, entrega 3; 4007) — os 8 avisos do Asaas, com prazo e
 * canais. Quem não edita vê a mesma tabela, travada.
 */

const CANAIS: { chave: "email" | "sms" | "whatsapp" | "phoneCall"; rotulo: string }[] = [
  { chave: "email", rotulo: "E-mail" },
  { chave: "sms", rotulo: "SMS" },
  { chave: "whatsapp", rotulo: "WhatsApp" },
  { chave: "phoneCall", rotulo: "Ligação" },
];

export function ReguaDaRede({ inicial, podeEditar }: { inicial: AvisoDaRegua[]; podeEditar: boolean }) {
  const router = useRouter();
  const [regua, setRegua] = useState<AvisoDaRegua[]>(inicial);
  const [pendente, start] = useTransition();
  const mudou = JSON.stringify(regua) !== JSON.stringify(inicial);

  const muda = (slot: string, campo: keyof AvisoDaRegua, valor: unknown) =>
    setRegua((rs) => rs.map((r) => (r.slot === slot ? { ...r, [campo]: valor } : r)));

  const gravar = () =>
    start(async () => {
      const r = await salvarRegua(regua);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível gravar.");
        return;
      }
      toast.success("Régua gravada. Os pagadores das unidades ligadas são atualizados no Asaas em até 10 minutos.");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Aviso</th>
              <th className="px-3 py-2 font-medium">Prazo</th>
              {CANAIS.map((c) => (
                <th key={c.chave} className="px-2 py-2 text-center font-medium">
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AVISOS_DA_REGUA.map((a) => {
              const r = regua.find((x) => x.slot === a.slot);
              if (!r) return null;
              const nenhum = !r.email && !r.sms && !r.whatsapp && !r.phoneCall;
              return (
                <tr key={a.slot} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className={cn("font-medium", nenhum && "text-muted-foreground line-through")}>{a.rotulo}</div>
                    <div className="text-xs text-muted-foreground">{a.explicacao}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.prazos ? (
                      <select
                        aria-label={`Prazo: ${a.rotulo}`}
                        className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-70"
                        disabled={!podeEditar || pendente}
                        value={String(r.scheduleOffset ?? a.prazos[0])}
                        onChange={(e) => muda(a.slot, "scheduleOffset", Number(e.target.value))}
                      >
                        {a.prazos.map((p) => (
                          <option key={p} value={p}>
                            {p === 0 ? "no dia" : `${p} dia${p > 1 ? "s" : ""} ${a.sentido}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-muted-foreground">fixo</span>
                    )}
                  </td>
                  {CANAIS.map((c) => (
                    <td key={c.chave} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${c.rotulo}: ${a.rotulo}`}
                        className="size-4 accent-primary"
                        disabled={!podeEditar || pendente}
                        checked={!!r[c.chave]}
                        onChange={(e) => muda(a.slot, c.chave, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={gravar} disabled={!mudou || pendente}>
            {pendente ? "Gravando…" : "Gravar a régua"}
          </Button>
          {mudou && (
            <Button variant="ghost" disabled={pendente} onClick={() => setRegua(inicial)}>
              Desfazer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function DeclaracaoDoTermo() {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [pendente, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await declararTermo(nota);
          if (!r.ok) {
            toast.error(r.error ?? "Não foi possível registrar.");
            return;
          }
          toast.success("Declaração registrada. As unidades já podem ser ligadas.");
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium" htmlFor="nota-termo">
        Onde está o termo atualizado (versão, data, link)
      </label>
      <Input
        id="nota-termo"
        value={nota}
        maxLength={500}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Ex.: Termo de privacidade v3, de 12/11/2026, com o Asaas como operador"
      />
      <Button type="submit" disabled={pendente || nota.trim().length < 5}>
        {pendente ? "Registrando…" : "Declaro que o termo de privacidade foi atualizado"}
      </Button>
    </form>
  );
}

export function BotaoDaUnidade({
  clinicId,
  ligada,
  podeLigar,
  motivoTravado,
}: {
  clinicId: string;
  ligada: boolean;
  podeLigar: boolean;
  motivoTravado: string | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pendente, start] = useTransition();
  const aplicar = (ligar: boolean) =>
    start(async () => {
      const r = await ligarReguaDaUnidade(clinicId, ligar);
      setConfirmando(false);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível gravar.");
        return;
      }
      toast.success(
        ligar
          ? "Régua ligada. Os pagadores da unidade são atualizados no Asaas em até 10 minutos."
          : "Régua desligada. Os avisos dos pagadores são desligados no Asaas em até 10 minutos."
      );
      router.refresh();
    });

  if (ligada) {
    return (
      <Button variant="outline" disabled={pendente} onClick={() => aplicar(false)}>
        {pendente ? "Desligando…" : "Desligar a régua desta unidade"}
      </Button>
    );
  }
  if (!podeLigar) {
    return motivoTravado ? <p className="text-sm text-muted-foreground">{motivoTravado}</p> : null;
  }
  if (!confirmando) {
    return <Button onClick={() => setConfirmando(true)}>Ligar a régua desta unidade</Button>;
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p>
        <strong>Antes de ligar:</strong> o riSZon vai mandar ao Asaas o e-mail e o celular dos pagadores desta unidade e
        aplicar a régua da rede em cada um. As cobranças <strong>já abertas</strong> passam a receber os{" "}
        <strong>próximos</strong> lembretes; o aviso &quot;cobrança criada&quot; não é reenviado para elas. Os avisos
        são tarifados na conta Asaas da unidade.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pendente} onClick={() => aplicar(true)}>
          {pendente ? "Ligando…" : "Ligar"}
        </Button>
        <Button variant="ghost" disabled={pendente} onClick={() => setConfirmando(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
