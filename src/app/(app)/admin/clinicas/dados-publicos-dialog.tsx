"use client";

// Dados públicos da unidade (0368 — Rita, Fase 0A.4): o que se pode dizer a um
// paciente sobre a unidade. O link do mapa é um dos itens do portão da Rita.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adicionarArea, removerArea, salvarDadosPublicos } from "./dados-publicos-actions";

export type DadosPublicosDaUnidade = {
  publicName: string | null;
  landmark: string | null;
  mapsUrl: string | null;
  parking: string | null;
  accessibility: string | null;
  whatsappE164: string | null;
  minChildAge: number | null;
};

export type AreaAtendida = { id: string; state: string; city: string; neighborhood: string | null };

export function DadosPublicosDialog({
  clinicId,
  clinicName,
  clinicState,
  dados,
  areas,
  trigger,
}: {
  clinicId: string;
  clinicName: string;
  clinicState: string | null;
  dados: DadosPublicosDaUnidade | null;
  areas: AreaAtendida[];
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    publicName: dados?.publicName ?? "",
    landmark: dados?.landmark ?? "",
    mapsUrl: dados?.mapsUrl ?? "",
    parking: dados?.parking ?? "",
    accessibility: dados?.accessibility ?? "",
    whatsapp: dados?.whatsappE164 ?? "",
    minChildAge: dados?.minChildAge == null ? "" : String(dados.minChildAge),
  });
  const [area, setArea] = useState({ state: clinicState ?? "", city: "", neighborhood: "" });
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  function salvar() {
    start(async () => {
      const r = await salvarDadosPublicos(clinicId, f);
      if (r.ok) {
        toast.success("Dados públicos salvos.");
        router.refresh();
        setOpen(false);
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function incluirArea() {
    start(async () => {
      const r = await adicionarArea(clinicId, area);
      if (r.ok) {
        setArea((a) => ({ ...a, city: "", neighborhood: "" }));
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function tirarArea(id: string) {
    start(async () => {
      const r = await removerArea(id);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dados públicos — {clinicName}</DialogTitle>
          <DialogDescription>
            O que pode ser dito a um paciente sobre a unidade (inclusive pela
            assistente virtual, quando ela for ligada). Nada aqui é obrigatório
            para salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="dp-nome">Nome público</Label>
            <Input id="dp-nome" value={f.publicName} onChange={muda("publicName")} placeholder="Ex.: Risarte Londrina Centro" />
          </div>
          <div>
            <Label htmlFor="dp-maps">Link do endereço no mapa</Label>
            <Input id="dp-maps" value={f.mapsUrl} onChange={muda("mapsUrl")} placeholder="https://maps.app.goo.gl/…" />
            <p className="mt-1 text-xs text-muted-foreground">
              No Google Maps: abra a unidade → Compartilhar → Copiar link.
            </p>
          </div>
          <div>
            <Label htmlFor="dp-ref">Ponto de referência</Label>
            <Input id="dp-ref" value={f.landmark} onChange={muda("landmark")} placeholder="Ex.: em frente à praça…" />
          </div>
          <div>
            <Label htmlFor="dp-est">Estacionamento</Label>
            <Input id="dp-est" value={f.parking} onChange={muda("parking")} placeholder="Ex.: estacionamento conveniado na rua de trás" />
          </div>
          <div>
            <Label htmlFor="dp-ace">Acessibilidade</Label>
            <Input id="dp-ace" value={f.accessibility} onChange={muda("accessibility")} placeholder="Ex.: térreo, rampa na entrada" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="dp-whats">WhatsApp da unidade</Label>
              <Input id="dp-whats" value={f.whatsapp} onChange={muda("whatsapp")} placeholder="(43) 99999-1234" />
            </div>
            <div>
              <Label htmlFor="dp-idade">Idade mínima para atender criança</Label>
              <Input id="dp-idade" inputMode="numeric" value={f.minChildAge} onChange={muda("minChildAge")} placeholder="vazia = consultar a equipe" />
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Cidades e bairros atendidos</p>
          {areas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma área cadastrada.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {areas.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    {a.city}/{a.state}
                    {a.neighborhood ? ` — ${a.neighborhood}` : " (cidade inteira)"}
                  </span>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => tirarArea(a.id)}>
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-16">
              <Label htmlFor="dp-uf">UF</Label>
              <Input id="dp-uf" maxLength={2} value={area.state} onChange={(e) => setArea((a) => ({ ...a, state: e.target.value }))} />
            </div>
            <div className="min-w-[8rem] flex-1">
              <Label htmlFor="dp-cidade">Cidade</Label>
              <Input id="dp-cidade" value={area.city} onChange={(e) => setArea((a) => ({ ...a, city: e.target.value }))} />
            </div>
            <div className="min-w-[8rem] flex-1">
              <Label htmlFor="dp-bairro">Bairro (opcional)</Label>
              <Input id="dp-bairro" value={area.neighborhood} onChange={(e) => setArea((a) => ({ ...a, neighborhood: e.target.value }))} />
            </div>
            <Button variant="outline" size="sm" disabled={pending} onClick={incluirArea}>
              Acrescentar
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Fechar
          </Button>
          <Button onClick={salvar} disabled={pending}>
            {pending ? "Salvando..." : "Salvar dados públicos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
