"use client";

import { opcoesDeConta, type ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";

/**
 * AP51 — o campo "Entrou em" (receber) / "Saiu de" (pagar). As opções e o que
 * vem preenchido saem de `conta-do-dinheiro.ts`; quem decide de verdade é o
 * banco (0317).
 */
export function CampoDaConta({
  rotulo,
  contas,
  clinicId,
  value,
  onChange,
}: {
  rotulo: "Entrou em" | "Saiu de";
  contas: ContaDaUnidade[];
  clinicId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const opcoes = opcoesDeConta(contas, clinicId);
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">{rotulo}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
      >
        {opcoes.map((o) => (
          <option key={o.value || "principal"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
