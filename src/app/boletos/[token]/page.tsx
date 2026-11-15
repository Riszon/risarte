import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { CascaPublica } from "@/components/indica/casca-publica";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { CopiarLinha } from "./copiar-linha";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Seus boletos",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type Boleto = { vencimento: string; valor: number; situacao: string; link: string | null; linha: string | null };
type Lista = { nome?: string | null; expira?: string; boletos?: Boleto[]; erro?: "invalido" | "expirado" | "limite" };

const SITUACAO: Record<string, string> = {
  a_pagar: "A pagar",
  vencido: "Vencido",
  pago: "Pago",
  pago_no_balcao: "Pago no balcão",
  pago_permuta: "Pago (permuta)",
  quitado_valor_menor: "Quitado",
  substituido_renegociacao: "Substituído pela renegociação — não pague",
  cancelado: "Cancelado — não pague este boleto",
  sem_boleto: "Boleto sendo gerado",
};
const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * /boletos/[código] — ASA4, 1B (4015; spec 19.25 e 19.26.3): a LISTA DOS BOLETOS
 * da forma 2, "Todos os boletos agora". Sem login. O banco guarda só o resumo do
 * código (SHA-256); cada acesso fica registrado (com o resumo do IP); endereço
 * errado tem limite por IP e o certo tem limite por hora; fora dos buscadores e
 * sem cache. Mostra só o primeiro nome, vencimento, valor, situação, "Abrir boleto"
 * (a fatura do Asaas) e a linha digitável.
 */
export default async function ListaDeBoletosPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  let lista: Lista = { erro: "invalido" };
  if (/^[0-9a-f]{64}$/.test(token) && isAdminClientConfigured()) {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "-";
    const { data } = await createAdminClient().rpc("_boleto_list_read", {
      p_token_hash: createHash("sha256").update(token).digest("hex"),
      p_ip_hash: createHash("sha256").update(`riszon-boletos:${ip}`).digest("hex"),
      p_user_agent: (h.get("user-agent") ?? "").slice(0, 120),
    });
    lista = (data as Lista) ?? { erro: "invalido" };
  }

  return (
    <CascaPublica>
      {lista.erro ? (
        <div className="rounded-xl border bg-background p-4 text-sm">
          <h1 className="text-lg font-semibold">
            {lista.erro === "limite" ? "Muitas tentativas" : lista.erro === "expirado" ? "Este link não vale mais" : "Link não encontrado"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {lista.erro === "limite"
              ? "Tente de novo daqui a uma hora."
              : "Peça um link novo à clínica Risarte que atendeu você."}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Olá{lista.nome ? `, ${lista.nome}` : ""}! Seus boletos</h1>
            <p className="text-sm text-muted-foreground">
              Aqui estão todos os boletos do seu tratamento. Perto de cada vencimento, enviamos um lembrete.
            </p>
          </div>
          <ul className="divide-y rounded-xl border bg-background">
            {(lista.boletos ?? []).map((b, k) => (
              <li key={k} className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Vencimento {fmt(b.vencimento)}</span>
                  <span className="tabular-nums">{brl(b.valor)}</span>
                </div>
                <p className={b.situacao.startsWith("cancelado") || b.situacao.startsWith("substituido") ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                  {SITUACAO[b.situacao] ?? b.situacao}
                </p>
                {(b.link || b.linha) && (
                  <div className="flex flex-wrap gap-2">
                    {b.link && (
                      <a href={b.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                        Abrir boleto
                      </a>
                    )}
                    {b.linha && <CopiarLinha linha={b.linha} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-center text-xs text-muted-foreground">Dúvidas? Fale com a clínica Risarte que atendeu você.</p>
        </>
      )}
    </CascaPublica>
  );
}
