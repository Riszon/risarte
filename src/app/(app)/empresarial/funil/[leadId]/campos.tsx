"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * Os pedaços de formulário que o LEVANTAMENTO e a PROPOSTA usam igual.
 *
 * ⚠️ Saíram de dentro do `ficha-lead.tsx` quando a proposta ganhou aba própria
 * (OC-00083). Copiá-los para o arquivo novo seria como as duas telas passam a
 * divergir: alguém ajusta o espaçamento de um `Campo` e só metade do sistema
 * muda — e ninguém percebe, porque as duas abas raramente são olhadas juntas.
 */

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Centavos → "39,90" para o campo de digitar. */
export const emReais = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/** "39,90" → 3990. Espelha a conversão do servidor. */
export function paraCentavos(valor: string): number {
  const n = Number.parseFloat(
    valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * "Não perguntei" é uma resposta diferente de "não" — e o levantamento precisa
 * das duas: o que não foi perguntado ainda pode ser, o que foi respondido
 * "não" já está decidido.
 */
export const TRI = [
  { value: "", label: "— não perguntei —" },
  { value: "SIM", label: "Sim" },
  { value: "NAO", label: "Não" },
];
export const triValor = (v: boolean | null) => (v == null ? "" : v ? "SIM" : "NAO");

export function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">{titulo}</p>
          {descricao && (
            <p className="text-xs text-muted-foreground">{descricao}</p>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function Campo({
  id,
  rotulo,
  ajuda,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

export function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    // `min-w-0` + `break-words`: sem eles, um rótulo ou um valor comprido
    // estoura a célula da grade em vez de quebrar, e escreve por cima do
    // vizinho. Foi assim que "MENSALIDADE" e "POR TITULAR" se sobrepuseram.
    <div className="min-w-0">
      <p className="text-[11px] leading-tight font-medium tracking-wider text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p
        className={`break-words ${destaque ? "text-lg font-semibold" : "text-sm"}`}
      >
        {valor}
      </p>
    </div>
  );
}
