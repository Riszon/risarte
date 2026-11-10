import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBrDateTime, formatInBrazil } from "@/lib/dates";
import { SEM_CONTAGEM, contagemConfirmada } from "@/lib/contagem";
import { isEmailConfigured } from "@/lib/notify/email";
import { canConfigureSignatures } from "@/lib/signatures/access";
import { loadSignatureSettings } from "@/lib/signatures/settings";
import { isZapsignConfigured, zapsignEnv } from "@/lib/zapsign/env";
import { Button } from "@/components/ui/button";
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

      <RotinasStatus limite={settings?.zapsign_monthly_limit ?? null} />

      {/* ZS2: os modelos de documento têm tela própria. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Modelos de documento</p>
          <p className="text-xs text-muted-foreground">Contrato, consentimento, orçamento, autorização de imagem e adesão empresarial: o texto, as testemunhas e quem assina pela Risarte.</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/assinaturas/configuracoes/modelos" />}>
          Abrir os modelos
        </Button>
      </div>

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

type Execucao = { ran_at: string; stats: Record<string, unknown> | null; error: string | null };

/**
 * ZS6: AS ROTINAS AUTOMÁTICAS — quando cada uma rodou pela última vez, o que
 * fez, o consumo do mês e a fila de e-mail. Lido pela chave de serviço DEPOIS
 * da guarda da página (só quem configura chega aqui): a fila não tem regra de
 * leitura para ninguém.
 */
async function RotinasStatus({ limite }: { limite: number | null }) {
  const admin = createAdminClient();
  const mes = formatInBrazil(new Date(), { year: "numeric", month: "2-digit" }).split("/").reverse().join("-");
  const [diaria, horaria, naFila, comErro, usados] = await Promise.all([
    admin.from("signature_job_runs").select("ran_at, stats, error").eq("job", "daily").order("ran_at", { ascending: false }).limit(1).maybeSingle<Execucao>(),
    admin.from("signature_job_runs").select("ran_at, stats, error").eq("job", "hourly").order("ran_at", { ascending: false }).limit(1).maybeSingle<Execucao>(),
    admin.from("signature_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("signature_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("signature_packages").select("id", { count: "exact", head: true }).eq("plan_month", mes),
  ]);
  const semRastro = diaria.error || horaria.error;
  const d = diaria.data;
  const h = horaria.data;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const emailLigado = isEmailConfigured();
  // AP136: contagem que falhou vira traço, não zero.
  const desistidos = contagemConfirmada(comErro);

  return (
    <div className="space-y-2 rounded-xl border px-4 py-3 text-sm">
      <p className="font-medium">Rotinas automáticas</p>
      {semRastro ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">Não foi possível ler o rastro das rotinas (falta a migração 0346 neste banco?).</p>
      ) : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Todo dia às 05:10</span> — vence o que passou do prazo, lembra quem enviou (dias configurados) e confere o consumo do plano.{" "}
            {d ? (
              d.error ? (
                <span className="text-destructive">Última vez em {formatBrDateTime(d.ran_at)}: deu erro.</span>
              ) : (
                <>Última vez em {formatBrDateTime(d.ran_at)}: {n(d.stats?.expired)} vencido(s), {n(d.stats?.reminded)} lembrete(s), {n(d.stats?.plan_alerts)} alerta(s) de consumo.</>
              )
            ) : (
              "Ainda não rodou neste banco."
            )}
          </li>
          <li>
            <span className="font-medium text-foreground">De hora em hora</span> — confere na ZapSign o pacote sem notícia, busca o PDF assinado que faltou e manda os e-mails.{" "}
            {h ? (
              <>
                Última vez em {formatBrDateTime(h.ran_at)}: {n(h.stats?.conferidos)} conferido(s), {n(h.stats?.atualizados)} atualização(ões), {n(h.stats?.pdfsBuscados)} PDF(s) buscado(s), {n(h.stats?.emailsEnviados)} e-mail(s) enviado(s)
                {h.error ? <span className="text-destructive"> — com erro em parte dos pacotes.</span> : "."}
              </>
            ) : (
              "Ainda não rodou neste ambiente."
            )}
          </li>
          <li>
            <span className="font-medium text-foreground">Consumo do mês ({mes})</span>: {contagemConfirmada(usados) ?? SEM_CONTAGEM} documento(s)
            {limite ? ` de ${limite} do plano` : " — sem limite cadastrado, não há alerta"}.
          </li>
          <li>
            <span className="font-medium text-foreground">E-mails</span>:{" "}
            {emailLigado ? "envio ligado." : <span className="text-amber-800 dark:text-amber-200">envio NÃO configurado (Resend) — os e-mails ficam na fila até configurar.</span>}{" "}
            {contagemConfirmada(naFila) ?? SEM_CONTAGEM} na fila
            {desistidos === null ? ", desistidos: não foi possível contar agora" : desistidos > 0 ? `, ${desistidos} desistido(s) depois de 3 tentativas` : ""}.
          </li>
        </ul>
      )}
    </div>
  );
}
