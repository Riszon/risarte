"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  MessageSquarePlus,
  MessagesSquare,
  MonitorPlay,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import {
  ABAS,
  MODULOS,
  MODULO_ROTULO,
  TIPO_ROTULO,
  aguardaSuporte,
  casaBusca,
  contarAbas,
  enderecoDoRelato,
  naAba,
  ordenar,
  relogioDoRelato,
  temRespostaNova,
  type Aba,
  type Relato,
} from "@/lib/system-reports";
import { nomeDaAba } from "@/lib/ambientes";
import type { NivelDoBanco } from "./dados";
import { FormularioDeRelato } from "./formulario";
import { CorDaIdade, SeloDeSituacao } from "./selos";

// Reexportado para quem já importava daqui (o teste do briefing).
export type { Relato } from "@/lib/system-reports";

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TODOS = "todos";

export function Problemas({
  relatos,
  isAdminMaster,
  nivel,
  semUnidade,
  abaDeInicio,
  abrirFormulario,
  telaSugerida,
  digestSugerido,
  versaoAtual,
  agora,
}: {
  relatos: Relato[];
  isAdminMaster: boolean;
  nivel: NivelDoBanco;
  semUnidade: boolean;
  abaDeInicio: Aba;
  abrirFormulario: boolean;
  telaSugerida: string;
  digestSugerido: string;
  versaoAtual: string;
  /** O instante do servidor: o navegador usa o MESMO, e o desenho não diverge. */
  agora: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abrirFormulario);
  const [aba, setAba] = useState<Aba>(abaDeInicio);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<string>(TODOS);
  const [modulo, setModulo] = useState<string>(TODOS);
  const [unidade, setUnidade] = useState<string>(TODOS);

  const unidades = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const r of relatos) mapa.set(r.clinicId, r.clinicName);
    return [...mapa].map(([value, label]) => ({ value, label }));
  }, [relatos]);

  // Os filtros valem ANTES das abas: o número de cada aba responde "quantos
  // relatos deste recorte estão ali", e não muda de sentido ao filtrar.
  const filtrados = useMemo(
    () =>
      relatos.filter(
        (r) =>
          casaBusca(r, busca) &&
          (tipo === TODOS || r.kind === tipo) &&
          (modulo === TODOS || (r.module ?? "sem") === modulo) &&
          (unidade === TODOS || r.clinicId === unidade)
      ),
    [relatos, busca, tipo, modulo, unidade]
  );
  const contagem = contarAbas(filtrados);
  const lista = ordenar(
    filtrados.filter((r) => naAba(r, aba)),
    aba
  );
  const filtrando =
    busca.trim() !== "" || tipo !== TODOS || modulo !== TODOS || unidade !== TODOS;

  const itensTipo = [
    { value: TODOS, label: "Todos os tipos" },
    ...Object.entries(TIPO_ROTULO).map(([value, label]) => ({ value, label })),
  ];
  const itensModulo = [
    { value: TODOS, label: "Todas as partes" },
    ...MODULOS.map((m) => ({ value: m.value, label: m.label })),
    { value: "sem", label: "Sem parte informada" },
  ];
  const itensUnidade = [{ value: TODOS, label: "Todas as unidades" }, ...unidades];

  return (
    <div className="space-y-4">
      {nivel === "sem_tabela" && (
        <Aviso titulo="Esta parte ainda não foi ligada neste banco.">
          Falta aplicar a <strong>migração 0247</strong>. Até lá o registro de
          problemas não grava — e é melhor dizer isso do que aceitar o texto e
          perdê-lo.
        </Aviso>
      )}
      {nivel === "sem_0256" && isAdminMaster && (
        <Aviso titulo="A conversa e o relógio ainda não estão ligados neste banco.">
          Falta aplicar a <strong>migração 0256</strong>. A lista funciona como
          antes: cada relato com uma resposta só, sem o tempo de cada fase.
        </Aviso>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
          {ABAS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setAba(a.value)}
              aria-current={aba === a.value ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5",
                aba === a.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {a.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  aba === a.value ? "bg-primary-foreground/20" : "bg-muted"
                )}
              >
                {contagem[a.value]}
              </span>
            </button>
          ))}
        </nav>

        <Button
          onClick={() => setAberto((v) => !v)}
          disabled={nivel === "sem_tabela" || semUnidade}
        >
          <MessageSquarePlus className="mr-2 size-4" />
          Relatar um problema
        </Button>
      </div>

      {semUnidade && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Escolha uma unidade no menu lateral para registrar — o relato pertence
          à unidade em que aconteceu.
        </p>
      )}

      {aberto && nivel !== "sem_tabela" && !semUnidade && (
        <FormularioDeRelato
          telaSugerida={telaSugerida}
          digestSugerido={digestSugerido}
          versaoAtual={versaoAtual}
          aoCancelar={() => setAberto(false)}
          aoRegistrar={(codigo) => {
            setAberto(false);
            // Abre o relato recém-criado: é ali que a resposta vai aparecer.
            router.push(`/problemas/${codigo}`);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código (OC-00009), título, texto ou pessoa"
            className="pl-8"
            aria-label="Buscar relatos"
          />
        </div>
        <Filtro rotulo="Tipo" itens={itensTipo} valor={tipo} aoMudar={setTipo} />
        <Filtro rotulo="Parte do sistema" itens={itensModulo} valor={modulo} aoMudar={setModulo} />
        {unidades.length > 1 && (
          <Filtro rotulo="Unidade" itens={itensUnidade} valor={unidade} aoMudar={setUnidade} />
        )}
        {filtrando && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBusca("");
              setTipo(TODOS);
              setModulo(TODOS);
              setUnidade(TODOS);
            }}
          >
            Limpar
          </Button>
        )}
      </div>

      {lista.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {filtrando
            ? "Nenhum relato com esses filtros nesta aba."
            : VAZIO[aba]}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {lista.map((r) => (
            <Linha key={r.id} relato={r} agora={agora} isAdminMaster={isAdminMaster} />
          ))}
        </ul>
      )}
    </div>
  );
}

const VAZIO: Record<Aba, string> = {
  fila: "Nenhum relato em aberto.",
  meus: "Você ainda não registrou nenhum relato.",
  respondidos: "Nenhum relato recebeu resposta ainda.",
  encerrados: "Nenhum relato encerrado ainda.",
  todos: "Nada registrado ainda.",
};

function Linha({
  relato: r,
  agora,
  isAdminMaster,
}: {
  relato: Relato;
  agora: number;
  isAdminMaster: boolean;
}) {
  const relogio = relogioDoRelato(r, agora);
  const novo = temRespostaNova(r);
  const esperando = isAdminMaster && aguardaSuporte(r);

  return (
    <li>
      {/* O relato do TREINO mora no banco de lá: o link abre a tela dele no
          ambiente de treino, em aba própria. Os do sistema abrem aqui mesmo. */}
      <Link
        href={enderecoDoRelato(r)}
        target={r.ambiente === "treino" ? nomeDaAba("treino") : undefined}
        className={cn(
          "flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50",
          novo && "bg-gold/10"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeloDeSituacao situacao={r.status} />
            <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
            {r.ambiente === "treino" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold-tinta">
                <MonitorPlay className="size-3" />
                Treino
              </span>
            )}
            {novo && (
              <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-gold-foreground">
                Resposta nova
              </span>
            )}
            {esperando && (
              <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary">
                {r.respostas === 0 ? "Sem resposta" : "Aguarda você"}
              </span>
            )}
            {r.reopenedCount > 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                Reaberto{r.reopenedCount > 1 ? ` ${r.reopenedCount}×` : ""}
              </span>
            )}
          </div>
          <p className="mt-1 font-medium">{r.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {TIPO_ROTULO[r.kind]} · {r.module ? MODULO_ROTULO[r.module] : "Sem parte informada"} ·{" "}
            {r.clinicName} · {r.reporterName}
            {r.reporterRole && ` (${r.reporterRole})`} · {quando(r.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <CorDaIdade faixa={relogio.faixa}>{relogio.principal}</CorDaIdade>
          {relogio.secundario && (
            <span className="text-muted-foreground">{relogio.secundario}</span>
          )}
          {r.respostas > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <MessagesSquare className="size-3.5" />
              {r.respostas === 1 ? "1 resposta" : `${r.respostas} respostas`}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Filtro({
  rotulo,
  itens,
  valor,
  aoMudar,
}: {
  rotulo: string;
  itens: { value: string; label: string }[];
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <Select items={itens} value={valor} onValueChange={(v) => aoMudar(v ?? TODOS)}>
      <SelectTrigger aria-label={rotulo} className="h-9 min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {itens.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
