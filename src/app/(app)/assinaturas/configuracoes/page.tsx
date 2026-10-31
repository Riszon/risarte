import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureSignatures } from "@/lib/signatures/access";
import { loadSignatureSettings } from "@/lib/signatures/settings";
import { isZapsignConfigured, zapsignEnv } from "@/lib/zapsign/env";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { SignatureSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Assinaturas — Configurações" };

/**
 * ZS1: os parâmetros da rede, o plano ZapSign e os destinatários do relatório
 * mensal. Só quem tem `acao.assinaturas.configurar` (o Admin Master sempre).
 * Modelos e kits entram nesta tela na ZS2.
 */
export default async function AssinaturasConfiguracoesPage() {
  const session = await getSessionContext();
  if (!canConfigureSignatures(session)) redirect("/assinaturas");

  const supabase = await createClient();
  const settings = await loadSignatureSettings(supabase);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={Settings}
        titulo="Configurações"
        descricao="Os parâmetros valem para toda a rede: prazos, lembretes, o corte da autenticação reforçada, o plano da ZapSign e quem recebe o relatório mensal."
        voltar={{ href: "/assinaturas", rotulo: "Assinaturas" }}
      />

      <ZapsignStatus configured={isZapsignConfigured()} env={zapsignEnv()} />

      {settings === null ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          A configuração ainda não existe neste banco (falta a migração 0340). Nada pode ser salvo até ela rodar.
        </p>
      ) : (
        <SignatureSettingsForm settings={settings} />
      )}
    </div>
  );
}

/**
 * O token e o ambiente são configuração da Vercel, não desta tela — mas é
 * aqui que o Admin olha quando "o envio não funciona". A tela só diz SE há
 * token e em QUAL ambiente; nunca mostra o valor.
 */
function ZapsignStatus({ configured, env }: { configured: boolean; env: "sandbox" | "production" }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm">
      <span className="font-medium">Conta ZapSign neste ambiente:</span>
      <span
        className={
          configured
            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
        }
      >
        {configured ? "token configurado" : "token não configurado"}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
        {env === "production" ? "produção (documentos valem)" : "sandbox (teste, sem validade jurídica)"}
      </span>
      {!configured && (
        <span className="basis-full text-xs text-muted-foreground">
          O token é cadastrado na Vercel (variável <code>ZAPSIGN_API_TOKEN</code>), nunca nesta tela. Sem ele, nenhum
          documento é enviado — as telas avisam.
        </span>
      )}
    </div>
  );
}
