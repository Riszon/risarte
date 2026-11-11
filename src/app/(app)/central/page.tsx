import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import {
  ESTADO_DA_CONTA,
  ESTADO_DA_PRONTIDAO,
  abasVisiveis,
  estadoDaProntidao,
  podeVerAba,
  primeiraAba,
  rotaDaRede,
  rotaDaUnidade,
} from "@/lib/central/central";
import { carregarContas, carregarProntidao } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Central de Configuração" };

/**
 * A porta da Central: o nível Rede e as unidades que a pessoa vê. Cada pessoa
 * vê só as abas dela (ver `podeVerAba`): o Gerente, por exemplo, só a aba
 * Financeiro da própria unidade. O selo de prontidão (conta Asaas) aparece
 * para quem vê a conta.
 */
export default async function CentralPage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const unidades = session.clinics
    .filter((c) => c.type !== "franchisor" && c.is_active && abasVisiveis(session, "unidade", c.id).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const abaDaRede = primeiraAba(session, "rede");
  const veContas = unidades.some((u) => podeVerAba(session, "conta", "unidade", u.id));
  const { contas, semMigracao } = veContas ? await carregarContas(supabase) : { contas: [], semMigracao: true };
  const prontidoes = await Promise.all(
    unidades.map((u) =>
      !semMigracao && podeVerAba(session, "conta", "unidade", u.id) ? carregarProntidao(supabase, u.id) : null
    )
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Configuração"
        icone={SlidersHorizontal}
        titulo="Central de Configuração"
        descricao="A configuração comercial e financeira da rede e de cada unidade, num lugar só. A conta Asaas ainda é só de TESTE (sandbox) até a integração ser liberada para produção."
      />

      {abaDaRede && (
        <Link href={rotaDaRede(abaDaRede)} className="block rounded-xl border p-4 hover:bg-muted/50">
          <p className="font-medium">Rede</p>
          <p className="text-sm text-muted-foreground">
            O padrão que toda unidade segue quando não tem valor próprio:{" "}
            {abasVisiveis(session, "rede")
              .map((a) => a.rotulo.toLowerCase())
              .join(", ")}
            .
          </p>
        </Link>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Unidades</h2>
        {unidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma unidade para mostrar.</p>
        ) : (
          <ul className="space-y-2">
            {unidades.map((u, i) => {
              const veConta = podeVerAba(session, "conta", "unidade", u.id);
              const conta = contas.find((c) => c.clinicId === u.id) ?? null;
              const p = prontidoes[i];
              const estado = p ? estadoDaProntidao(p.itens, p.marcada) : null;
              const faltam = p ? p.itens.filter((x) => !x.ok).length : 0;
              const abas = abasVisiveis(session, "unidade", u.id);
              return (
                <li key={u.id}>
                  <Link
                    href={rotaDaUnidade(u.id, abas[0].id)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-4 hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {veConta
                          ? conta
                            ? `Conta Asaas: ${(ESTADO_DA_CONTA[conta.status] ?? ESTADO_DA_CONTA.awaiting_key).rotulo.toLowerCase()}${conta.environment === "sandbox" ? " (teste)" : ""}`
                            : "Sem conta Asaas cadastrada"
                          : abas.map((a) => a.rotulo).join(", ")}
                        {estado === "faltam_itens" ? ` · ${faltam} item(ns) faltando` : ""}
                      </p>
                    </div>
                    {estado && (
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", ESTADO_DA_PRONTIDAO[estado].tom)}>
                        {ESTADO_DA_PRONTIDAO[estado].rotulo}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
