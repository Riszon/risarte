import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, ChevronRight } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AVISO_SEM_SCHEMA,
  ESTADO_DA_RITA,
  estadoDaUnidade,
  faltaExporRita,
  podeLigarRita,
  podeVerRita,
  type UnidadeDaLista,
} from "@/lib/rita-tela";
import { InterruptorDaRita } from "./interruptor";

export const metadata: Metadata = { title: "Assistente virtual" };

export default async function RitaPage() {
  const session = await getSessionContext();
  if (!podeVerRita(session)) redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase.schema("rita").rpc("screen_units");
  const unidades = (data ?? []) as UnidadeDaLista[];
  const redeLigada = unidades[0]?.network_enabled ?? false;

  return (
    <div className="space-y-6">
      <CabecalhoDeModulo
        chapeu="Assistente virtual"
        icone={Bot}
        titulo="O que a Rita sabe"
        descricao="A Rita vai atender pelo WhatsApp. Aqui você vê, unidade por unidade, o que ela vai dizer e o que falta para ligar."
      />

      {error ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {faltaExporRita(error)
            ? AVISO_SEM_SCHEMA
            : "Não foi possível ler a assistente virtual agora. Tente de novo em instantes."}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">A rede</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {redeLigada
                    ? "Ligada. Cada unidade ainda é ligada à parte."
                    : "Desligada. Com a rede desligada, nenhuma unidade liga."}
                </p>
              </div>
              <InterruptorDaRita
                clinicId={null}
                nome="toda a rede"
                ligada={redeLigada}
                podeLigar={podeLigarRita(session)}
                podeDesligar={podeLigarRita(session)}
              />
            </CardHeader>
          </Card>

          {unidades.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma unidade para mostrar.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {unidades.map((u) => {
                const estado = ESTADO_DA_RITA[estadoDaUnidade(u)];
                return (
                  <li key={u.clinic_id}>
                    <Link
                      href={`/rita/${u.clinic_id}`}
                      className="flex min-w-0 items-center gap-3 p-4 hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{u.clinic_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {u.gaps === 0
                            ? "Nada falta."
                            : u.gaps === 1
                              ? "Falta 1 item."
                              : `Faltam ${u.gaps} itens.`}
                          {u.paused_auto && u.paused_reason ? ` ${u.paused_reason}` : ""}
                        </p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", estado.tom)}>
                        {estado.rotulo}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
