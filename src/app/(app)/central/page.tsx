import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import {
  ESTADO_DA_CONTA,
  ESTADO_DA_PRONTIDAO,
  estadoDaProntidao,
  podeVerRedeNaCentral,
  podeVerUnidadeNaCentral,
  rotaDaRede,
  rotaDaUnidade,
} from "@/lib/central/central";
import { carregarContas, carregarProntidao } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AvisoSemMigracao } from "./abas";

export const metadata: Metadata = { title: "Central de Configuração" };

/**
 * A porta da Central: o nível Rede e a lista de unidades, cada uma com o selo
 * de prontidão. Configurar uma unidade é revisar exceções, não preencher tudo.
 */
export default async function CentralPage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { contas, semMigracao } = await carregarContas(supabase);

  const unidades = session.clinics
    .filter((c) => c.type !== "franchisor" && c.is_active && podeVerUnidadeNaCentral(session, c.id))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const prontidoes = semMigracao
    ? []
    : await Promise.all(unidades.map((u) => carregarProntidao(supabase, u.id)));

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Administração"
        icone={SlidersHorizontal}
        titulo="Central de Configuração"
        descricao="A configuração comercial e financeira da rede e de cada unidade, num lugar só. Nesta etapa: a conta Asaas e as tarifas. Tudo aqui é conta de TESTE (sandbox) até a integração ser liberada para produção."
      />

      {semMigracao && <AvisoSemMigracao />}

      {podeVerRedeNaCentral(session) && (
        <Link href={rotaDaRede()} className="block rounded-xl border p-4 hover:bg-muted/50">
          <p className="font-medium">Rede</p>
          <p className="text-sm text-muted-foreground">
            O padrão da rede e a conta raiz da franqueadora, que emite o Empresarial e a cobrança mensal às unidades e
            recebe os repasses.
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
              const conta = contas.find((c) => c.clinicId === u.id) ?? null;
              const p = prontidoes[i];
              const estado = p ? estadoDaProntidao(p.itens, p.marcada) : "nao_conferida";
              const visual = ESTADO_DA_PRONTIDAO[estado];
              const faltam = p ? p.itens.filter((x) => !x.ok).length : 0;
              return (
                <li key={u.id}>
                  <Link href={rotaDaUnidade(u.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-4 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {conta
                          ? `Conta Asaas: ${(ESTADO_DA_CONTA[conta.status] ?? ESTADO_DA_CONTA.awaiting_key).rotulo.toLowerCase()}${conta.environment === "sandbox" ? " (teste)" : ""}`
                          : "Sem conta Asaas cadastrada"}
                        {estado === "faltam_itens" ? ` · ${faltam} item(ns) faltando` : ""}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", visual.tom)}>{visual.rotulo}</span>
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
