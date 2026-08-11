"use client";

// Reajuste de preços em massa e comissão em massa.
//
// Nasceram no catálogo (F3.2 / H4.13) e MUDARAM DE CASA por decisão do dono
// (08/08/2026): os dois são atos de PRECIFICAÇÃO, não de cadastro. Quem reajusta
// preço quer ver custo, margem e preço sugerido na mesma tela — no catálogo ele
// aplicava um percentual às cegas e só descobria o efeito na margem depois,
// noutra tela.
//
// Ficam num arquivo próprio porque as duas rotas (/procedimentos e
// /procedimentos/precificacao) são do MESMO módulo; o que não se faz é acoplar
// módulos diferentes.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";
import { readjustPrices, setCommissionBulk } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type BulkScope = "all" | "specialty" | "pillar" | "selected";

type SharedProps = {
  specialties: string[];
  selectedCount: number;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
  getSelectedIds: () => string[];
  onDone: () => void;
};

/** Escopo compartilhado pelos dois painéis. */
function ScopePicker({
  scope,
  setScope,
  specialty,
  setSpecialty,
  pillar,
  setPillar,
  specialties,
  selectedCount,
}: {
  scope: BulkScope;
  setScope: (s: BulkScope) => void;
  specialty: string;
  setSpecialty: (s: string) => void;
  pillar: string;
  setPillar: (s: string) => void;
  specialties: string[];
  selectedCount: number;
}) {
  return (
    <>
      <div>
        <Label>Aplicar a</Label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as BulkScope)}
          className={selectClass.replace("w-full", "w-48")}
        >
          <option value="all">Todos os procedimentos</option>
          <option value="specialty">Por especialidade</option>
          <option value="pillar">Por pilar</option>
          <option value="selected">Selecionados ({selectedCount})</option>
        </select>
      </div>
      {scope === "specialty" && (
        <div>
          <Label>Especialidade</Label>
          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className={selectClass.replace("w-full", "w-44")}
          >
            <option value="">Selecione...</option>
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      {scope === "pillar" && (
        <div>
          <Label>Pilar</Label>
          <select
            value={pillar}
            onChange={(e) => setPillar(e.target.value)}
            className={selectClass.replace("w-full", "w-44")}
          >
            <option value="">Selecione...</option>
            {METHODOLOGY_PILLARS.map((p) => (
              <option key={p} value={p}>
                {PILLAR_LABELS[p as MethodologyPillar]}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export function ReadjustPanel({
  specialties,
  selectedCount,
  isPending,
  run,
  getSelectedIds,
  onDone,
}: SharedProps) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [scope, setScope] = useState<BulkScope>("all");
  const [specialty, setSpecialty] = useState("");
  const [pillar, setPillar] = useState("");
  const [applyToBand, setApplyToBand] = useState(true);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Reajuste de preços em massa</CardTitle>
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((s) => !s)}
        >
          {open ? "Fechar" : "Abrir"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Percentual (%)</Label>
              <Input
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 10 ou -5"
                className="w-28"
              />
            </div>
            <ScopePicker
              scope={scope}
              setScope={setScope}
              specialty={specialty}
              setSpecialty={setSpecialty}
              pillar={pillar}
              setPillar={setPillar}
              specialties={specialties}
              selectedCount={selectedCount}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyToBand}
              onChange={(e) => setApplyToBand(e.target.checked)}
            />
            Ajustar também os preços mínimo e máximo
          </label>
          <Button
            size="sm"
            disabled={!percent.trim() || isPending}
            onClick={() =>
              run(
                () =>
                  readjustPrices({
                    percent,
                    scope,
                    specialty: specialty || undefined,
                    pillar: pillar || undefined,
                    ids: scope === "selected" ? getSelectedIds() : undefined,
                    applyToBand,
                  }),
                "Reajuste aplicado.",
                () => {
                  setPercent("");
                  onDone();
                }
              )
            }
          >
            Aplicar reajuste
          </Button>
          <p className="text-xs text-muted-foreground">
            Use “Selecionados” marcando os procedimentos na lista abaixo. O
            reajuste fica registrado no histórico de cada procedimento.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/** H4.13: definir a comissão (%, R$ fixo, ou ambos) em massa, por escopo. */
export function CommissionPanel({
  specialties,
  selectedCount,
  isPending,
  run,
  getSelectedIds,
  onDone,
}: SharedProps) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("");
  const [scope, setScope] = useState<BulkScope>("all");
  const [specialty, setSpecialty] = useState("");
  const [pillar, setPillar] = useState("");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Comissão em massa</CardTitle>
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((s) => !s)}
        >
          {open ? "Fechar" : "Abrir"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Comissão (%)</Label>
              <Input
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 10"
                className="w-24"
              />
            </div>
            <div>
              <Label>Comissão fixa (R$)</Label>
              <Input
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 5,00"
                className="w-28"
              />
            </div>
            <ScopePicker
              scope={scope}
              setScope={setScope}
              specialty={specialty}
              setSpecialty={setSpecialty}
              pillar={pillar}
              setPillar={setPillar}
              specialties={specialties}
              selectedCount={selectedCount}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Deixe um dos campos em branco para não alterá-lo. Ex.: só o “%” muda a
            comissão percentual e mantém a fixa.
          </p>
          <Button
            size="sm"
            disabled={(!percent.trim() && !fixed.trim()) || isPending}
            onClick={() =>
              run(
                () =>
                  setCommissionBulk({
                    percent: percent || undefined,
                    fixed: fixed || undefined,
                    scope,
                    specialty: specialty || undefined,
                    pillar: pillar || undefined,
                    ids: scope === "selected" ? getSelectedIds() : undefined,
                  }),
                "Comissão aplicada.",
                () => {
                  setPercent("");
                  setFixed("");
                  onDone();
                }
              )
            }
          >
            Aplicar comissão
          </Button>
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            <strong>Regra:</strong> este é o <strong>degrau 3/4</strong> do
            repasse — o valor que vale quando o procedimento não tem valor
            cadastrado para o nível do dentista. Só é contabilizado quando o
            procedimento é <strong>finalizado</strong>, e quem paga é o
            Financeiro (Repasses).
          </p>
        </CardContent>
      )}
    </Card>
  );
}
