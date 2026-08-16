"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  digits,
  invoiceErrors,
  isValidGtin,
  matchLines,
  suggestItem,
  toCents,
  type NfeInvoice,
  type NfeLine,
} from "@/lib/nfe";
import { importNfe, resolveNfeItems } from "./actions";

type Item = {
  id: string;
  name: string;
  brand: string;
  purchaseUnit: string;
  unitsPerPurchase: number;
};

/**
 * O XML é lido NO NAVEGADOR, com o DOMParser nativo — sem dependência nova e
 * sem mandar o arquivo para o servidor antes de alguém olhar o que veio dentro.
 */
function readNfe(xml: string): NfeInvoice {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const txt = (node: Element | Document, tag: string): string =>
    node.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  const key = digits(infNFe?.getAttribute("Id") ?? txt(doc, "chNFe"));

  const emit = doc.getElementsByTagName("emit")[0];
  const ide = doc.getElementsByTagName("ide")[0];

  const lines: NfeLine[] = Array.from(doc.getElementsByTagName("det")).map(
    (det) => {
      const prod = det.getElementsByTagName("prod")[0];
      const gtin = txt(prod, "cEAN");
      return {
        supplierCode: txt(prod, "cProd"),
        description: txt(prod, "xProd"),
        // "SEM GTIN" é o preenchimento oficial quando não há código.
        gtin: isValidGtin(gtin) ? digits(gtin) : "",
        unit: txt(prod, "uCom") || "un",
        quantity: Number(txt(prod, "qCom")) || 0,
        unitCostCents: toCents(txt(prod, "vUnCom")),
        totalCents: toCents(txt(prod, "vProd")),
      };
    }
  );

  // As duplicatas são os vencimentos — é isso que hoje se digita à mão.
  const installments = Array.from(doc.getElementsByTagName("dup")).map((d) => ({
    dueDate: txt(d, "dVenc"),
    amountCents: toCents(txt(d, "vDup")),
  }));

  const total = toCents(
    doc.getElementsByTagName("ICMSTot")[0]
      ? txt(doc.getElementsByTagName("ICMSTot")[0], "vNF")
      : "0"
  );

  return {
    key,
    number: ide ? txt(ide, "nNF") : "",
    issueDate: (ide ? txt(ide, "dhEmi") || txt(ide, "dEmi") : "").slice(0, 10),
    supplierCnpj: emit ? digits(txt(emit, "CNPJ")) : "",
    supplierName: emit ? txt(emit, "xNome") : "",
    totalCents: total,
    lines,
    installments:
      installments.length > 0
        ? installments
        : // Nota à vista não traz duplicata: uma parcela na data de emissão.
          [
            {
              dueDate: (ide ? txt(ide, "dhEmi") || txt(ide, "dEmi") : "").slice(
                0,
                10
              ),
              amountCents: total,
            },
          ],
  };
}

type Row = {
  line: NfeLine;
  itemId: string;
  matchedBy: "gtin" | "fornecedor" | "sugestao" | null;
  packages: string;
};

export function NfeImport({
  clinicId,
  items,
  suppliers,
  costCenters,
}: {
  clinicId: string;
  items: Item[];
  suppliers: { id: string; name: string; document: string }[];
  costCenters: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [invoice, setInvoice] = useState<NfeInvoice | null>(null);
  const [xmlText, setXmlText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");

  async function onFile(file: File) {
    const text = await file.text();
    let parsed: NfeInvoice;
    try {
      parsed = readNfe(text);
    } catch {
      toast.error("Não consegui ler este arquivo como XML de NF-e.");
      return;
    }

    const problems = invoiceErrors(parsed);
    setErrors(problems);
    setInvoice(parsed);
    setXmlText(text);

    // O fornecedor é achado pelo CNPJ da nota, não pelo nome.
    const known = suppliers.find(
      (s) => digits(s.document) === parsed.supplierCnpj
    );
    setSupplierId(known?.id ?? "");

    if (problems.length > 0) {
      setRows([]);
      return;
    }

    startTransition(async () => {
      const resolved = await resolveNfeItems({
        cnpj: parsed.supplierCnpj,
        codes: parsed.lines.map((l) => l.supplierCode),
        gtins: parsed.lines.map((l) => l.gtin),
      });

      const matches = matchLines(parsed.lines, {
        byGtin: resolved.byGtin,
        bySupplierCode: resolved.bySupplierCode,
      });

      setRows(
        parsed.lines.map((line, i) => {
          const m = matches[i];
          // Só quando NÃO houve casamento por código é que a descrição entra —
          // e apenas como sugestão, esperando confirmação.
          const guess =
            m.itemId === null ? suggestItem(line.description, items) : null;
          return {
            line,
            itemId: m.itemId ?? guess?.itemId ?? "",
            matchedBy: m.itemId ? m.matchedBy : guess ? "sugestao" : null,
            packages: String(line.quantity),
          };
        })
      );
    });
  }

  const pending = rows.filter((r) => !r.itemId).length;
  const suggested = rows.filter((r) => r.matchedBy === "sugestao").length;

  function confirm() {
    if (!invoice) return;
    startTransition(async () => {
      const r = await importNfe({
        clinicId,
        supplierId,
        costCenterId,
        nfeKey: invoice.key,
        invoiceNumber: invoice.number,
        issueDate: invoice.issueDate,
        supplierCnpj: invoice.supplierCnpj,
        xml: xmlText,
        items: rows
          .filter((x) => x.itemId)
          .map((x) => ({
            itemId: x.itemId,
            packages: x.packages,
            packageCostCents: x.line.unitCostCents,
            supplierCode: x.line.supplierCode,
            supplierDescription: x.line.description,
            gtin: x.line.gtin,
          })),
        installments: invoice.installments,
      });
      if (r.ok) {
        toast.success("Nota importada — estoque e conta a pagar lançados.");
        setInvoice(null);
        setRows([]);
        setXmlText("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card className={cn(isPending && "opacity-70")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1 font-medium">
              <FileUp className="size-4 text-primary" />
              Importar nota fiscal (XML)
            </h2>
            <p className="text-[11px] text-muted-foreground">
              O arquivo que o fornecedor manda por e-mail junto com o DANFE. O
              sistema lê e <strong>monta o lançamento</strong>; você confere e
              confirma — nada é gravado antes disso.
            </p>
          </div>
          <Input
            type="file"
            accept=".xml,text/xml"
            className="h-8 w-64 text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </div>

        {errors.length > 0 && (
          <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
            {errors.map((e, i) => (
              <li key={i} className="flex items-start gap-1">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                {e}
              </li>
            ))}
          </ul>
        )}

        {invoice && errors.length === 0 && (
          <>
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
              <div className="sm:col-span-2 text-xs">
                <p className="font-medium">{invoice.supplierName}</p>
                <p className="text-muted-foreground">
                  CNPJ {invoice.supplierCnpj} · NF {invoice.number} ·{" "}
                  {invoice.issueDate.split("-").reverse().join("/")}
                </p>
              </div>
              <label className="block">
                <Label className="text-[11px]">Fornecedor no sistema</Label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Centro de custo</Label>
                <select
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">—</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ul className="space-y-1">
              {rows.map((r, idx) => (
                <li key={idx} className="rounded-lg border p-2 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-muted-foreground">
                        {r.line.supplierCode}
                      </span>{" "}
                      {r.line.description}
                      {r.line.gtin && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          GTIN {r.line.gtin}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      {r.line.quantity} {r.line.unit} ×{" "}
                      {formatBRL(r.line.unitCostCents)} ={" "}
                      <strong>{formatBRL(r.line.totalCents)}</strong>
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <label className="block min-w-56 flex-1">
                      <Label className="text-[11px]">
                        Nosso item
                        {r.matchedBy === "gtin" && (
                          <Badge
                            variant="outline"
                            className="ml-1 border-emerald-400 text-[10px] text-emerald-700"
                          >
                            código de barras
                          </Badge>
                        )}
                        {r.matchedBy === "fornecedor" && (
                          <Badge
                            variant="outline"
                            className="ml-1 border-emerald-400 text-[10px] text-emerald-700"
                          >
                            já vinculado
                          </Badge>
                        )}
                        {r.matchedBy === "sugestao" && (
                          <Badge
                            variant="outline"
                            className="ml-1 border-amber-400 text-[10px] text-amber-800"
                          >
                            sugestão — confira
                          </Badge>
                        )}
                      </Label>
                      <select
                        value={r.itemId}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    itemId: e.target.value,
                                    matchedBy: x.matchedBy ?? "sugestao",
                                  }
                                : x
                            )
                          )
                        }
                        className={cn(
                          "h-8 w-full rounded-md border bg-background px-2 text-xs",
                          r.itemId ? "border-input" : "border-amber-400"
                        )}
                      >
                        <option value="">Escolher o item…</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                            {i.brand ? ` · ${i.brand}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block w-32">
                      <Label className="text-[11px]">
                        Quantas{" "}
                        {items.find((i) => i.id === r.itemId)?.purchaseUnit ??
                          "embalagens"}
                      </Label>
                      <Input
                        className="h-8"
                        inputMode="decimal"
                        value={r.packages}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x, i) =>
                              i === idx ? { ...x, packages: e.target.value } : x
                            )
                          )
                        }
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ul>

            <div className="rounded-lg border bg-muted/30 p-2 text-xs">
              <strong>Vencimentos da nota:</strong>{" "}
              {invoice.installments
                .map(
                  (p) =>
                    `${p.dueDate.split("-").reverse().join("/")} ${formatBRL(p.amountCents)}`
                )
                .join(" · ")}
            </div>

            {(pending > 0 || suggested > 0) && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                {pending > 0 && (
                  <>
                    <strong>{pending}</strong> linha
                    {pending === 1 ? "" : "s"} ainda sem item — aponte qual é o
                    nosso.{" "}
                  </>
                )}
                {suggested > 0 && (
                  <>
                    <strong>{suggested}</strong> por sugestão: confira antes de
                    confirmar. O que você confirmar vira o vínculo, e a próxima
                    nota deste fornecedor já vem reconhecida.
                  </>
                )}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                Total da nota: <strong>{formatBRL(invoice.totalCents)}</strong>
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setInvoice(null);
                    setRows([]);
                    setErrors([]);
                  }}
                >
                  Cancelar
                </Button>
                <Button size="sm" disabled={isPending || pending > 0} onClick={confirm}>
                  Confirmar e lançar
                </Button>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
