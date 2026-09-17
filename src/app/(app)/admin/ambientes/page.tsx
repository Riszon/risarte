import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { carregarAmbientes } from "@/lib/ambientes-db";
import { treinoConfigurado } from "@/lib/treino";
import { EditorDeAmbientes } from "./editor";

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
