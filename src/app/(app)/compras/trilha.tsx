import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Handshake,
  PackageCheck,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O CAMINHO DE UMA COMPRA — as etapas, no lugar dos quatro links soltos.
 *
 * ⚠️ A NUMERAÇÃO AQUI NÃO É ENFEITE. Compra na Risarte é uma sequência de
 * verdade, e a ordem carrega informação que quem opera precisa: a unidade PEDE,
 * a rede NEGOCIA, a unidade APROVA (é ela quem paga) e depois RECEBE. Quem
 * inverte dois desses passos recebe material que ninguém aprovou. Numerar uma
 * lista que não fosse sequência seria decoração; esta é.
 *
 * ⚠️ E O PAINEL NÃO ENTRA NA TRILHA. Ele não é etapa: é onde se mede o
 * resultado depois. Pô-lo como "passo 4" ensinaria uma ordem que não existe.
 * Por isso ele fica embaixo, num bloco de outro peso — junto da mesa de
 * negociação, que é uma sala da Franqueadora, não da unidade.
 *
 * O NÚMERO EM CADA ETAPA É O QUE ESPERA POR VOCÊ, e vem do banco. Etapa sem
 * nada pendente não mostra número nenhum: um "0" pendurado em toda etapa vira
 * ruído, e em duas semanas ninguém olha mais para os que não são zero.
 *
 * ⚠️ E ELA APARECE EM TODAS AS TELAS DO FLUXO, não só na primeira. O dono
 * apontou o que faltava (10/09/2026): *"quando clica em qualquer botão, abre a
 * tela, mas não tem um fluxo legal ainda, pois não tem um voltar; deve ter uma
 * sensação de continuidade mesmo quando está dentro de uma etapa"*.
 *
 * Uma trilha que some assim que você entra numa etapa não é trilha — é um menu
 * que aparece uma vez. Presente em toda tela, com a etapa atual marcada, ela
 * responde três perguntas ao mesmo tempo: onde estou, o que vem antes e o que
 * vem depois. E o caminho de volta deixa de precisar de um botão próprio,
 * porque toda etapa é clicável.
 */

export type EtapaAtual = "pedir" | "aprovar" | "receber" | "painel" | "mesa";

type Etapa = {
  n: number;
  href: string;
  icone: LucideIcon;
  titulo: string;
  linha: string;
  /** Quantos itens esperam nesta etapa. `null` quando não se conta. */
  esperando?: number | null;
  atual?: boolean;
};

function Cartao({ etapa }: { etapa: Etapa }) {
  const { n, href, icone: Icone, titulo, linha, esperando, atual } = etapa;

  const corpo = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
            atual
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {n}
        </span>
        <Icone
          className={cn(
            "size-4 shrink-0",
            atual ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {titulo}
        </span>
        {typeof esperando === "number" && esperando > 0 && (
          <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gold-tinta">
            {esperando}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {linha}
      </p>
      {atual && (
        <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-primary">
          Você está aqui
        </p>
      )}
    </>
  );

  const classe = cn(
    "block rounded-xl border p-4 transition",
    atual
      ? "border-primary/40 bg-primary/5"
      : "bg-card hover:border-primary/40 hover:shadow-sm"
  );

  // A etapa atual não é link: clicar nela não leva a lugar nenhum, e link que
  // não vai a lugar nenhum ensina a desconfiar dos outros.
  return atual ? (
    <div className={classe}>{corpo}</div>
  ) : (
    <Link href={href} className={classe}>
      {corpo}
    </Link>
  );
}

/**
 * Painel e Mesa: fora da sequência, mas parte do mesmo lugar.
 *
 * Eles seguem a mesma regra das etapas — quando você ESTÁ neles, deixam de ser
 * link e se marcam. Sem isso, a pessoa dentro do Painel clicaria em "Painel de
 * compras" e não sairia do lugar, que é o jeito mais rápido de fazer alguém
 * desconfiar de todos os outros cartões da tela.
 */
function ForaDaTrilha({
  href,
  atual,
  className,
  children,
}: {
  href: string;
  atual: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classe = cn(
    "flex items-center gap-3 rounded-xl border px-4 py-3 transition",
    atual
      ? "border-primary/40 bg-primary/5"
      : "hover:border-primary/40 hover:shadow-sm",
    className
  );
  return atual ? (
    <div className={classe}>{children}</div>
  ) : (
    <Link href={href} className={classe}>
      {children}
    </Link>
  );
}

export function TrilhaDaCompra({
  atual,
  aguardandoAprovacao,
  entregasAbertas,
  podeVerMesa,
}: {
  /** Em que ponto do caminho esta tela está. */
  atual: EtapaAtual;
  aguardandoAprovacao: number;
  entregasAbertas: number;
  podeVerMesa: boolean;
}) {
  const etapas: Etapa[] = [
    {
      n: 1,
      href: "/compras",
      icone: ClipboardList,
      titulo: "Pedir",
      linha:
        "O que está abaixo do mínimo vira lista. Você ajusta e envia à Franqueadora.",
      atual: atual === "pedir",
    },
    {
      n: 2,
      href: "/compras/aprovar",
      icone: ThumbsUp,
      titulo: "Aprovar",
      linha:
        "O que a rede negociou para a sua unidade. Sem a sua aprovação o pedido não nasce.",
      esperando: aguardandoAprovacao,
      atual: atual === "aprovar",
    },
    {
      n: 3,
      href: "/compras/receber",
      icone: PackageCheck,
      titulo: "Receber",
      linha:
        "A entrega chega, você confere pela nota e o material entra no estoque.",
      esperando: entregasAbertas,
      atual: atual === "receber",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {etapas.map((e) => (
          <Cartao key={e.n} etapa={e} />
        ))}
      </div>

      <div className={cn("grid gap-3", podeVerMesa && "sm:grid-cols-2")}>
        <ForaDaTrilha
          href="/compras/painel"
          atual={atual === "painel"}
          className="bg-card"
        >
          <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Painel de compras
            </span>
            <span className="block text-xs text-muted-foreground">
              Quanto a rede economizou para você, e quanto foi comprado por fora.
            </span>
          </span>
        </ForaDaTrilha>

        {podeVerMesa && (
          <ForaDaTrilha
            href="/compras/rodadas"
            atual={atual === "mesa"}
            className="border-dashed"
          >
            <Handshake className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                Mesa de negociação
              </span>
              {/* A borda tracejada não é estilo: marca que esta é uma sala da
                  FRANQUEADORA, não uma etapa da unidade. Quem não negocia pela
                  rede nem enxerga este cartão. */}
              <span className="block text-xs text-muted-foreground">
                Sala da Franqueadora: cotar com os fornecedores e escolher de
                quem comprar cada item.
              </span>
            </span>
          </ForaDaTrilha>
        )}
      </div>
    </div>
  );
}
