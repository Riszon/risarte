"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  ClipboardList,
  FileText,
  HeartHandshake,
  History,
  Inbox,
  ListChecks,
  Route,
  Smile,
  Stethoscope,
  User,
  Wallet,
  Activity,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PanelProps = {
  id: string;
  label: string;
  /** Quantidade a destacar em vermelho no rótulo (ex.: parcelas em atraso). */
  alertCount?: number;
  children: ReactNode;
};

/** Ícone por aba (identidade visual). Aba sem ícone mapeado mostra só o rótulo. */
const TAB_ICONS: Record<string, LucideIcon> = {
  cadastro: User,
  jornada: Route,
  clinico: Stethoscope,
  odontograma: Smile,
  "linha-do-tempo": Clock,
  desenvolvimento: Activity,
  plano: ClipboardList,
  sessoes: ListChecks,
  documentos: FileText,
  pedidos: Inbox,
  financeiro: Wallet,
  indica: HeartHandshake,
  historico: History,
};

/**
 * OS GRUPOS DA BARRA (28/10/2026). Treze abas numa fila só não contam a
 * história; em quatro grupos, contam: a pessoa, o que a boca dela tem, o
 * que foi combinado fazer e o dinheiro. A ordem das abas DENTRO da página
 * continua mandando (o grupo só agrupa o que existe); aba cujo id não está
 * aqui cai no último grupo.
 */
const GRUPOS: { titulo: string; abas: string[] }[] = [
  { titulo: "Pessoa", abas: ["cadastro", "jornada", "historico"] },
  { titulo: "Clínico", abas: ["clinico", "odontograma", "desenvolvimento", "linha-do-tempo"] },
  { titulo: "Tratamento", abas: ["plano", "sessoes", "pedidos", "documentos"] },
  { titulo: "Dinheiro", abas: ["financeiro", "indica"] },
];

/** Marcador de aba — não renderiza sozinho; o ProntuarioTabs lê id/label/filhos.
 * Uso: <ProntuarioTabs><TabPanel id="x" label="X">…</TabPanel>…</ProntuarioTabs> */
export const TabPanel: (props: PanelProps) => ReactNode = () => null;

/** H4.10: a ficha do cliente em abas (na sequência do fluxo). Mantém todas as
 * abas montadas (esconde as inativas) para não perder o estado dos editores.
 * Refino visual: aba ativa com acento dourado (sublinhado) + ícone; a barra
 * em grupos com título pequeno. */
export function ProntuarioTabs({
  children,
  initialTab,
}: {
  children: ReactNode;
  /** A aba pedida: pelo endereço (`?aba=pedidos`, vinda do aviso) ou pelo
   * papel de quem abre (`abaInicialDoProntuario`). Se a pessoa não tem essa
   * aba, abre na primeira — como antes. */
  initialTab?: string | null;
}) {
  const panels = Children.toArray(children).filter(
    (c): c is ReactElement<PanelProps> =>
      isValidElement(c) &&
      typeof (c.props as Partial<PanelProps>).id === "string"
  );
  const [active, setActive] = useState<string>(
    panels.find((p) => p.props.id === initialTab)?.props.id ??
      panels[0]?.props.id ??
      ""
  );

  // A barra rola de lado: aberta direto numa aba do fim (Pedidos, Histórico),
  // ela ficaria fora da vista e a pessoa não veria em que aba está. Só mexe na
  // rolagem da BARRA — a página fica onde está.
  const barra = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialTab) return;
    const el = barra.current;
    const botao = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && botao) el.scrollLeft = botao.offsetLeft - el.clientWidth / 2 + botao.clientWidth / 2;
  }, [initialTab]);

  // Monta os grupos só com as abas que esta pessoa tem; grupo vazio some.
  const conhecidas = new Set(GRUPOS.flatMap((g) => g.abas));
  const grupos = GRUPOS.map((g) => ({
    titulo: g.titulo,
    paineis: panels.filter((p) => g.abas.includes(p.props.id)),
  }));
  const soltas = panels.filter((p) => !conhecidas.has(p.props.id));
  if (soltas.length > 0) grupos[grupos.length - 1].paineis.push(...soltas);
  const visiveis = grupos.filter((g) => g.paineis.length > 0);

  return (
    <div>
      <div
        ref={barra}
        className="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto border-b border-border bg-background/95 px-4 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] supports-[backdrop-filter]:bg-background/80 [&::-webkit-scrollbar]:hidden"
      >
        <div role="tablist" className="flex items-end">
          {visiveis.map((g, gi) => (
            <div
              key={g.titulo}
              className={cn(
                "flex flex-col",
                gi > 0 && "ml-2 border-l border-border pl-2"
              )}
            >
              <span className="px-3 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                {g.titulo}
              </span>
              <div className="flex gap-1">
                {g.paineis.map((p) => {
                  const Icon = TAB_ICONS[p.props.id];
                  const isActive = active === p.props.id;
                  return (
                    <button
                      key={p.props.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActive(p.props.id)}
                      className={cn(
                        "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "border-gold text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                        (p.props.alertCount ?? 0) > 0 && !isActive && "text-destructive"
                      )}
                    >
                      {Icon && (
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            isActive ? "text-gold-tinta" : "text-muted-foreground"
                          )}
                        />
                      )}
                      {p.props.label}
                      {/* Alerta na própria aba: o usuário vê o atraso sem abri-la. */}
                      {(p.props.alertCount ?? 0) > 0 && (
                        <span
                          title="Cobranças em atraso"
                          className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white tabular-nums"
                        >
                          {p.props.alertCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {panels.map((p) => (
        <div
          key={p.props.id}
          role="tabpanel"
          hidden={active !== p.props.id}
          className="space-y-4"
        >
          {p.props.children}
        </div>
      ))}
    </div>
  );
}
