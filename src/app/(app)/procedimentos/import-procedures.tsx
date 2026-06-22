"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";
import { importProcedures } from "./actions";
import type { ProcedureInput } from "./actions";

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

// pt-BR pillar label (accent-insensitive) → enum value.
const PILLAR_BY_LABEL = new Map<string, MethodologyPillar>(
  METHODOLOGY_PILLARS.map((p) => [norm(PILLAR_LABELS[p]), p])
);

const TEMPLATE_HEADERS = [
  "Nome do Procedimento",
  "Código TUSS",
  "Especialidade",
  "Pilar da Metodologia",
  "Preço Padrão",
  "Preço Mínimo",
  "Preço Máximo",
  "Comissão (%)",
  "Comissão (R$)",
];

const TEMPLATE_EXAMPLES = [
  ["Restauração em resina", "85100201", "Dentística", "Função", "250,00", "200,00", "350,00", "10", "0"],
  ["Clareamento dental", "", "Estética", "Estética", "800,00", "", "", "15", "50,00"],
];

function mapRow(obj: Record<string, unknown>): ProcedureInput {
  const m: Record<string, string> = {};
  for (const key of Object.keys(obj)) m[norm(key)] = String(obj[key] ?? "").trim();
  const get = (...keys: string[]) => {
    for (const k of keys) if (m[k]) return m[k];
    return "";
  };
  const pillarLabel = get("pilar da metodologia", "pilar");
  return {
    name: get("nome do procedimento", "nome"),
    tussCode: get("codigo tuss", "tuss"),
    specialty: get("especialidade"),
    pillar: pillarLabel ? (PILLAR_BY_LABEL.get(norm(pillarLabel)) ?? "") : "",
    defaultPrice: get("preco padrao", "preco"),
    minPrice: get("preco minimo"),
    maxPrice: get("preco maximo"),
    commissionPercent: get("comissao (%)", "comissao %", "comissao percentual"),
    commissionFixed: get("comissao (r$)", "comissao r$", "comissao fixa", "comissao valor"),
  };
}

export function ImportProcedures() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ProcedureInput[]>([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Procedimentos");
      XLSX.writeFile(wb, "modelo-procedimentos.xlsx");
    } catch {
      toast.error("Não foi possível gerar o modelo.");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
      });
      const mapped = json.map(mapRow).filter((r) => r.name.trim() !== "");
      setRows(mapped);
      if (mapped.length === 0) {
        toast.error("Nenhuma linha válida — confira a coluna “Nome do Procedimento”.");
      }
    } catch {
      toast.error("Não foi possível ler a planilha.");
      setRows([]);
    }
  }

  function doImport() {
    startTransition(async () => {
      const result = await importProcedures(rows);
      if (result.ok) {
        toast.success(
          `Importação concluída: ${result.inserted ?? 0} novo(s), ${result.updated ?? 0} atualizado(s)` +
            (result.errors ? `, ${result.errors} ignorado(s).` : ".")
        );
        setRows([]);
        setFileName("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Importar procedimentos (Excel)</CardTitle>
        <Button size="sm" variant="outline" onClick={downloadTemplate}>
          <Download className="mr-1 size-4" />
          Baixar modelo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Como preencher a planilha:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>
              Colunas: <strong>{TEMPLATE_HEADERS.join(", ")}</strong>.
            </li>
            <li>
              <strong>Nome do Procedimento</strong> é obrigatório. Linhas sem nome
              são ignoradas.
            </li>
            <li>
              O <strong>código interno é gerado automaticamente</strong> — não
              precisa incluir.
            </li>
            <li>
              <strong>Pilar da Metodologia</strong>: use um de{" "}
              {METHODOLOGY_PILLARS.map((p) => PILLAR_LABELS[p]).join(", ")} (ou
              deixe em branco).
            </li>
            <li>Preços e comissão (R$) em reais (ex.: 250,00). Comissão (%) só o número (ex.: 10).</li>
            <li>
              Se o <strong>nome</strong> já existir, o procedimento é{" "}
              <strong>atualizado</strong>; senão, é criado.
            </li>
          </ul>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="mr-1 size-4" />
            Escolher planilha
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground">
              {fileName} — {rows.length} procedimento(s) lido(s)
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-2 text-sm">
              {rows.slice(0, 8).map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className="text-muted-foreground">
                    {r.specialty || "—"} · {r.defaultPrice || "0,00"}
                  </span>
                </li>
              ))}
              {rows.length > 8 && (
                <li className="text-xs text-muted-foreground">
                  …e mais {rows.length - 8}.
                </li>
              )}
            </ul>
            <Button size="sm" disabled={isPending} onClick={doImport}>
              {isPending ? "Importando..." : `Importar ${rows.length} procedimento(s)`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
