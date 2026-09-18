import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { carregarAmbientes } from "@/lib/ambientes-db";
import { treinoConfigurado } from "@/lib/treino";
import { isTreino } from "@/lib/environment";
import { formatBrDateTime } from "@/lib/dates";
import { EditorDeAmbientes } from "./editor";
import { SincronizarTreino } from "./sincronizar-treino";

type EstadoDoEspelho = {
  last_full_sync_at: string | null;
  last_sync_at: string | null;
  pending: boolean;
  last_error: string | null;
  last_error_at: string | null;
};

export const metadata: Metadata = { title: "Ambientes" };

/**
 * OS ENDEREÇOS DOS TRÊS AMBIENTES (0259).
 *
 * O atalho do Início precisa saber para onde levar, e o Risarte Academy ainda
 * não foi publicado. Deixar o endereço no código obrigaria uma entrega nova no
 * dia em que ele for ao ar; aqui ele é configuração — o Admin cola o endereço e
 * o atalho aparece para quem tem o ambiente liberado.
 *
 * ⚠️ Endereço é CONFIGURAÇÃO: não viaja entre produção e treino (CLAUDE.md
 * §0b). Se mudar aqui, mude nos dois.
 */
export default async function AmbientesPage() {
  await requireAdminMaster();
  const supabase = await createClient();
  const ambientes = await carregarAmbientes(supabase);
  // 0260: como está a cópia para o treino (só faz sentido na produção).
  const { data: espelho } = isTreino()
    ? { data: null }
    : await supabase
        .from("mirror_state")
        .select("last_full_sync_at, last_sync_at, pending, last_error, last_error_at")
        .maybeSingle<EstadoDoEspelho>();

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Globe className="size-6 text-gold-tinta" />
          Ambientes
        </h1>
        <p className="text-sm text-muted-foreground">
          Os três lugares que o Risartano acessa com o mesmo login. O endereço
          de cada um manda no atalho que aparece na tela de Início.
        </p>
      </header>

      {ambientes.length === 0 ? (
        <p className="rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm">
          Esta tela precisa da migração <b>0259</b>. Rode-a no banco e recarregue.
        </p>
      ) : (
        <EditorDeAmbientes ambientes={ambientes} />
      )}

      {!isTreino() && treinoConfigurado() && (
        <section className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <div>
            <h2 className="text-sm font-semibold">O treino é cópia deste sistema</h2>
            <p className="text-muted-foreground">
              Risartanos, logins, funções, ambientes e permissões se cadastram
              e se alteram só aqui. Cada alteração é copiada para o treino
              sozinha; lá, tudo isso é só para consulta.
            </p>
          </div>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Última cópia completa</dt>
              <dd>
                {espelho?.last_full_sync_at
                  ? formatBrDateTime(espelho.last_full_sync_at)
                  : "ainda não foi feita"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Última cópia de uma alteração</dt>
              <dd>
                {espelho?.last_sync_at ? formatBrDateTime(espelho.last_sync_at) : "—"}
              </dd>
            </div>
          </dl>
          {espelho?.pending && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <b>Há alteração que não chegou ao treino</b>
              {espelho.last_error_at
                ? ` (${formatBrDateTime(espelho.last_error_at)})`
                : ""}
              {espelho.last_error ? `: ${espelho.last_error}.` : "."} Clique em
              sincronizar para copiar tudo de novo.
            </p>
          )}
          {!espelho && (
            <p className="text-xs text-destructive">
              Esta parte precisa da migração <b>0260</b> neste banco.
            </p>
          )}
          <SincronizarTreino />
        </section>
      )}

      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">
          O que cada ambiente exige por trás
        </h2>
        <p>
          <b>riSZon Treino</b> — tem banco próprio. Liberar o treino para alguém
          cria o login dela lá, com o mesmo e-mail.{" "}
          {treinoConfigurado() ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Está ligado neste servidor.
            </span>
          ) : (
            <b className="text-destructive">
              Ainda não está ligado: faltam as variáveis TREINO_SUPABASE_URL e
              TREINO_SERVICE_ROLE_KEY na Vercel.
            </b>
          )}
        </p>
        <p>
          <b>Risarte Academy</b> — divide o mesmo banco deste sistema, então o
          login já é o mesmo. A marcação na ficha controla o atalho daqui; a
          porta de lá depende de ajuste no próprio Academy.
        </p>
        <p>
          Quem pode entrar em cada ambiente se decide na ficha de cada pessoa,
          em <b>Risartanos → Acesso</b>.
        </p>
      </section>
    </div>
  );
}
