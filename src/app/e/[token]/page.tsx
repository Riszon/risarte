import type { Metadata } from "next";
import { CascaPublica } from "@/components/indica/casca-publica";
import { origemDoSite, portalCatalogo, portalEmbaixador } from "@/lib/indica/publico";
import { INDICACAO_STATUS_LABEL, type IndicacaoStatus } from "@/lib/indica/status";
import { TIPO_LANCAMENTO_LABEL } from "@/lib/indica/rotulos";
import { formatBrDate } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { BotaoResgatar, CompartilharLink, IndicarAmigo } from "./interacoes";

export const metadata: Metadata = {
  title: "Meu Indica +Risos",
  robots: { index: false, follow: false },
};

/**
 * /e/[token] — o PORTAL DO EMBAIXADOR, pelo link mágico (sem conta).
 * Mostra só o que é dele: saldo, nível, etapas das indicações (nunca dado
 * clínico ou valor do tratamento do indicado), extrato e catálogo.
 */
export default async function PortalPage(props: PageProps<"/e/[token]">) {
  const { token } = await props.params;
  const valido = /^[0-9a-f]{64}$/.test(token);
  const [portal, catalogo] = valido
    ? await Promise.all([portalEmbaixador(token), portalCatalogo(token)])
    : [null, null];

  if (!portal) {
    return (
      <CascaPublica>
        <div className="rounded-xl border bg-background p-4 text-sm">
          <h1 className="text-lg font-semibold">Acesso vencido</h1>
          <p className="mt-1 text-muted-foreground">
            Este link não vale mais. Peça um novo na sua unidade Risarte.
          </p>
        </div>
      </CascaPublica>
    );
  }

  const link = `${await origemDoSite()}/i/${portal.embaixador.codigo}`;
  const disponivel = portal.saldo?.disponivel ?? 0;

  return (
    <CascaPublica>
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">Olá, {portal.embaixador.primeiro_nome}!</p>
        <p className="text-4xl font-semibold">{disponivel}</p>
        <p className="text-sm">Riso Coins disponíveis</p>
        <p className="text-xs text-muted-foreground">
          {portal.saldo?.pendente ?? 0} pendentes · {portal.saldo?.em_carencia ?? 0} em carência
          {portal.saldo && portal.saldo.a_vencer_30_dias > 0 ? ` · ${portal.saldo.a_vencer_30_dias} vencem em 30 dias` : ""}
        </p>
        <span className="inline-block rounded-full bg-gold px-2.5 py-0.5 text-xs text-gold-foreground">
          {portal.embaixador.nivel.nome}
        </span>
      </section>

      <section className="space-y-2 rounded-xl border bg-background p-4">
        <h2 className="font-semibold">Indicar</h2>
        <p className="text-sm text-muted-foreground">
          Seu código: <span className="font-mono font-medium text-foreground">{portal.embaixador.codigo}</span>. Cada
          amigo que vier conhecer e começar o tratamento vira Riso Coins para você.
        </p>
        <CompartilharLink link={link} primeiroNome={portal.embaixador.primeiro_nome} />
        <details className="pt-1">
          <summary className="cursor-pointer text-sm font-medium">Prefere cadastrar o amigo aqui?</summary>
          <div className="pt-2">
            <IndicarAmigo token={token} />
          </div>
        </details>
      </section>

      <section className="space-y-2 rounded-xl border bg-background p-4">
        <h2 className="font-semibold">Minhas indicações</h2>
        {portal.indicacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ainda. Que tal mandar seu convite?</p>
        ) : (
          <ul className="divide-y text-sm">
            {portal.indicacoes.map((i) => (
              <li key={i.codigo} className="flex justify-between gap-2 py-1.5">
                <span>{i.indicado ?? "Indicação"}</span>
                <span className="text-muted-foreground">
                  {INDICACAO_STATUS_LABEL[i.etapa as IndicacaoStatus] ?? i.etapa}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border bg-background p-4">
        <h2 className="font-semibold">Trocar Riso Coins</h2>
        {(catalogo ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">O catálogo está sendo preparado.</p>
        ) : (
          <ul className="space-y-2">
            {(catalogo ?? []).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.custo} Riso Coins
                    {item.valor_centavos && item.tipo === "credito_risarte" ? ` · ${formatBRL(item.valor_centavos)} em tratamento` : ""}
                    {!item.disponivel ? " · indisponível" : ""}
                  </p>
                </div>
                <BotaoResgatar token={token} itemId={item.id} custo={item.custo} pode={item.disponivel && disponivel >= item.custo} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Riso Coins não valem dinheiro. O prêmio pode ser presenteado; os Riso Coins, não.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border bg-background p-4">
        <h2 className="font-semibold">Extrato</h2>
        {portal.extrato.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem movimentos.</p>
        ) : (
          <ul className="divide-y text-sm">
            {portal.extrato.slice(0, 40).map((l, idx) => (
              <li key={idx} className="flex justify-between gap-2 py-1.5">
                <span>
                  {TIPO_LANCAMENTO_LABEL[l.tipo] ?? l.tipo}
                  <span className="block text-[11px] text-muted-foreground">
                    {formatBrDate(l.criado_em)}
                    {l.expira_em ? ` · vence ${formatBrDate(l.expira_em)}` : ""}
                  </span>
                </span>
                <span className={cn("font-mono", l.riso_coins < 0 && "text-destructive")}>
                  {l.riso_coins > 0 ? "+" : ""}
                  {l.riso_coins}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CascaPublica>
  );
}
