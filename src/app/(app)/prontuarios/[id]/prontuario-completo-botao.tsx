"use client";

// OD6 (J3): o botão do prontuário completo — pede o MOTIVO, registra a geração
// e abre o documento para imprimir / salvar em PDF.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MOTIVOS_DO_PRONTUARIO, type MotivoDoProntuario } from "@/lib/prontuario/linha-do-tempo";
import { gerarProntuarioCompleto } from "./prontuario-completo-actions";

export function BotaoProntuarioCompleto({ clientId }: { clientId: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState<MotivoDoProntuario | "">("");
  const [nota, setNota] = useState("");
  const [isPending, startTransition] = useTransition();
  const pronto = motivo !== "" && (motivo !== "outro" || nota.trim().length >= 5);

  function gerar() {
    if (!motivo) return;
    // A aba abre JÁ (no clique) — aberta depois da espera, o navegador bloqueia.
    const aba = window.open("", "_blank");
    startTransition(async () => {
      const r = await gerarProntuarioCompleto({ clientId, motivo, nota });
      if (!r.ok) {
        aba?.close();
        toast.error(r.error);
        return;
      }
      setAberto(false);
      setMotivo("");
      setNota("");
      const url = `/prontuario-completo/${r.id}`;
      if (aba) aba.location.href = url;
      else window.location.assign(url);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <FileText className="mr-1 size-4" /> Prontuário completo
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar o prontuário completo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O documento reúne todo o registro clínico do paciente, com fotos e radiografias. A
            geração fica registrada com o seu nome, a data e o motivo — e o rodapé do documento diz
            isso.
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium">Motivo</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(Object.keys(MOTIVOS_DO_PRONTUARIO) as MotivoDoProntuario[]).map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} />
                  {MOTIVOS_DO_PRONTUARIO[m]}
                </label>
              ))}
            </div>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={motivo === "outro" ? "Qual o motivo? (obrigatório)" : "Observação (opcional)"}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={!pronto || isPending} onClick={gerar}>
              {isPending ? "Gerando…" : "Gerar e abrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
