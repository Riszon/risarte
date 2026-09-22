"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterForm } from "@/components/filter-form";
import { WEEKDAY_NAMES, type OnlineAgendaSettings } from "@/lib/agenda-settings";
import { salvarJornadaOnline, voltarAoPadraoDaRede } from "./actions";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * A JORNADA DO ATENDIMENTO ONLINE (0268) — relato OC-00072.
 *
 * Mesma forma da configuração da agenda da unidade, trocando "unidade" por
 * "consultor": padrão da rede primeiro, exceção por pessoa depois. A tela diz
 * DE ONDE vem o que está valendo — sem isso ninguém sabe se está olhando a
 * regra da rede ou a exceção daquela pessoa, e a cascata vira adivinhação.
 */
export function EditorDaJornada({
  escopo,
  consultores,
  valores,
  temExcecao,
}: {
  /** "" = padrão da rede; senão, o id do consultor. */
  escopo: string;
  consultores: { id: string; full_name: string }[];
  valores: OnlineAgendaSettings;
  temExcecao: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inicio, setInicio] = useState(valores.openTime);
  const [fim, setFim] = useState(valores.closeTime);
  const [dias, setDias] = useState<number[]>(valores.weekdays);

  const ehRede = escopo === "";

  function alternarDia(d: number) {
    setDias((antes) => (antes.includes(d) ? antes.filter((x) => x !== d) : [...antes, d]));
  }

  function salvar() {
    startTransition(async () => {
      const r = await salvarJornadaOnline(escopo || null, {
        openTime: inicio,
        closeTime: fim,
        weekdays: dias,
      });
      if (r.ok) {
        toast.success(ehRede ? "Padrão da rede salvo." : "Jornada do consultor salva.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function voltarAoPadrao() {
    startTransition(async () => {
      const r = await voltarAoPadraoDaRede(escopo);
      if (r.ok) {
        toast.success("Este consultor voltou a seguir a rede.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wifi className="size-4 text-primary" />
          {ehRede ? "Padrão da rede" : "Jornada deste consultor"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FilterForm className="flex flex-wrap items-center gap-2">
          <Label htmlFor="consultor" className="text-xs">
            Configurando
          </Label>
          <select
            id="consultor"
            name="consultor"
            defaultValue={escopo}
            className={selectClass}
          >
            <option value="">Padrão da rede (todos os consultores)</option>
            {consultores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </FilterForm>

        {!ehRede && (
          <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            {temExcecao ? (
              <>
                Este consultor tem <strong>jornada própria</strong>. Mudanças no
                padrão da rede não o alcançam enquanto ela existir.
              </>
            ) : (
              <>
                Este consultor <strong>segue a rede</strong>. Os valores abaixo
                são os da rede; salvar cria a jornada própria dele.
              </>
            )}
          </p>
        )}

        <div className="grid gap-3 @md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inicio" className="text-xs">
              Começa a atender
            </Label>
            <Input
              id="inicio"
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fim" className="text-xs">
              Encerra o atendimento
            </Label>
            <Input
              id="fim"
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Dias de atendimento</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_NAMES.map((nome, d) => (
              <button
                key={nome}
                type="button"
                onClick={() => alternarDia(d)}
                aria-pressed={dias.includes(d)}
                className={
                  dias.includes(d)
                    ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium"
                    : "rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {nome.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={isPending} onClick={salvar}>
            Salvar
          </Button>
          {!ehRede && temExcecao && (
            <Button variant="outline" disabled={isPending} onClick={voltarAoPadrao}>
              Voltar ao padrão da rede
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
