"use client";


import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowRight, Camera, LifeBuoy, Timer, Undo2, XIcon } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { contarPendentesDoTreino } from "@/app/(app)/relatos-treino-actions";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { moduloDaTela } from "@/lib/system-reports";
import { MAXIMO_POR_ENVIO, nomeDaCaptura } from "@/lib/anexos-de-relato";
import { SEGUNDOS_DA_CONTAGEM, capturarTela } from "@/lib/captura-de-tela";
import {
  LEVAR_RELATO,
  type RelatoParaLevar,
  type ValoresDoRelato,
} from "@/lib/levar-relato";
import { Button } from "@/components/ui/button";
import { FormularioDeRelato } from "@/app/(app)/problemas/formulario";
import {
  ContagemDaFoto,
  avisarCaptura,
  avisarFalhaDaCaptura,
  montarPendentes,
  type AnexoPendente,
} from "@/app/(app)/problemas/anexos";

/** Quem já leu a resposta avisa por aqui, e o número cai na hora. */
export const RELATOS_VISTOS = "relatos-vistos";

/**
 * O relato em andamento. Mora AQUI, na barra de cima (que fica montada em
 * todas as telas), e não dentro do formulário: é o que permite a pessoa sair
 * navegando para capturar a tela do problema sem perder o que escreveu.
 */
type Rascunho = {
  /** Onde o relato começou. */
  origem: string;
  /** Muda a cada relato novo — é o que zera os campos de texto. */
  chave: number;
  anexos: AnexoPendente[];
  tela: string;
  telaEditada: boolean;
  modulo: string | null;
  moduloEditado: boolean;
  /** Preenchido quando o relato veio da PÁGINA de Problemas (21/09/2026). */
  iniciais?: ValoresDoRelato;
};

function novoRascunho(origem: string): Rascunho {
  return {
    origem,
    chave: Date.now(),
    anexos: [],
    tela: origem,
    telaEditada: false,
    modulo: moduloDaTela(origem),
    moduloEditado: false,
  };
}

/**
 * A BOIA, com o indicador de relatos esperando — e, desde a 0257, a porta do
 * relato: ela abre o formulário num painel POR CIMA da tela atual, que é onde
 * a captura de tela precisa estar.
 *
 * ⚠️ O PROBLEMA NEM SEMPRE ESTÁ NA TELA ATRÁS DO PAINEL (dono, 17/09/2026:
 * "vai capturar sempre a tela de onde relata o problema"). Por isso existe o
 * MODO DE CAPTURA: o painel fecha sem perder o rascunho, uma barra aparece no
 * rodapé, a pessoa navega até a tela do problema e captura ali — quantas vezes
 * precisar — e volta ao relato. Se ela não mexeu na tela e na parte do sistema
 * à mão, as duas passam a ser as da última captura: é lá que o problema está.
 *
 * ⚠️ O NÚMERO NÃO É O MESMO PARA TODO MUNDO, e é essa a decisão central. Quem
 * responde é o Admin Master, então para ele o indicador é a FILA DELE (relatos
 * abertos e em análise) e zera respondendo. Para todo o resto, contar a fila
 * seria pendurar no ícone um número sobre o qual a pessoa não pode fazer nada —
 * e ícone com número que não é seu ensina a ignorar números. Para ela o
 * indicador conta as RESPOSTAS que ainda não leu, e zera ao abrir o relato.
 *
 * **A regra mora no banco** (`system_reports_pending`, 0252), não aqui. A tela
 * daria conta de montar as duas consultas; se montasse, a régua do que "está
 * pendente" passaria a existir em dois lugares, e o dia em que discordassem
 * seria o dia em que alguém precisa confiar no número.
 *
 * ⚠️ A CONSULTA PARTE DO NAVEGADOR, como a do sino — uma vez por minuto e a
 * cada navegação. Ela não entra no tempo de abrir tela nenhuma, que foi o custo
 * que o dia 08/09/2026 inteiro foi gasto reduzindo.
 *
 * Banco ainda sem a 0252: a função não existe, o `rpc` devolve erro e o número
 * fica em zero. Ícone sem indicador é a mesma coisa de antes desta entrega; um
 * erro na tela por causa de migração pendente não seria.
 */
export function ReportNavItem({
  temUnidade,
  isAdminMaster,
}: {
  /** Relato pertence a uma unidade: sem unidade ativa não há onde gravar. */
  temUnidade: boolean;
  isAdminMaster: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendentes, setPendentes] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  // Durante a captura o painel (ou a barra) fica INVISÍVEL, não fechado:
  // fechar apagaria o que a pessoa já escreveu, e visível sairia na foto.
  const [escondido, setEscondido] = useState(false);
  const [modoCaptura, setModoCaptura] = useState(false);
  const [capturando, setCapturando] = useState(false);
  // Quantos segundos faltam para a foto (0 = sem contagem em curso).
  const [faltam, setFaltam] = useState(0);

  const consultar = useCallback(async () => {
    // O número junta OS DOIS AMBIENTES (19/09/2026): o daqui vem do banco,
    // pela sessão de quem está logado; o do treino vem pelo servidor, que é
    // quem tem a chave de lá. Falha no treino vira 0, nunca uma barra quebrada.
    const supabase = createClient();
    const [local, treino] = await Promise.all([
      supabase.rpc("system_reports_pending"),
      contarPendentesDoTreino().catch(() => 0),
    ]);
    const daqui = typeof local.data === "number" ? local.data : 0;
    return daqui + treino;
  }, []);

  useEffect(() => {
    let cancelado = false;

    const atualizar = async () => {
      const n = await consultar();
      if (!cancelado) setPendentes(n);
    };

    atualizar();
    const intervalo = setInterval(atualizar, 60_000);

    // Sem isto, quem acabou de ler a resposta continuaria vendo o número até a
    // próxima consulta — até um minuto olhando para um aviso já resolvido.
    window.addEventListener(RELATOS_VISTOS, atualizar);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      window.removeEventListener(RELATOS_VISTOS, atualizar);
    };
  }, [consultar, pathname]); // reconsulta ao navegar (ex.: depois de responder)

  /**
   * O RELATO QUE CHEGA DA PÁGINA DE PROBLEMAS (21/09/2026).
   *
   * Lá o formulário morre na navegação; aqui a barra de cima continua montada.
   * Então a página entrega o que já foi escrito e esta barra assume, entrando
   * direto no modo de captura — que é o que a pessoa foi buscar.
   */
  useEffect(() => {
    function receber(evento: Event) {
      const { valores, anexos } = (evento as CustomEvent<RelatoParaLevar>).detail;
      const tela = valores.screen || pathname;
      setRascunho({
        origem: tela,
        chave: Date.now(),
        anexos,
        tela,
        // Veio digitado por gente: a captura numa outra tela não sobrescreve.
        telaEditada: Boolean(valores.screen),
        modulo: valores.module,
        moduloEditado: Boolean(valores.module),
        iniciais: valores,
      });
      setAberto(false);
      setModoCaptura(true);
      toast.info("Vá até a tela do problema e clique em Capturar.", {
        description: "O que você escreveu está guardado na barra de baixo.",
      });
    }
    window.addEventListener(LEVAR_RELATO, receber);
    return () => window.removeEventListener(LEVAR_RELATO, receber);
  }, [pathname]);

  function abrir(proximo: boolean) {
    if (proximo && !rascunho) setRascunho(novoRascunho(pathname));
    if (proximo) setModoCaptura(false);
    setAberto(proximo);
  }

  function descartar() {
    rascunho?.anexos.forEach((a) => a.previa && URL.revokeObjectURL(a.previa));
    setRascunho(null);
    setModoCaptura(false);
  }

  /** A captura foi tirada NESTA tela: ela passa a ser a tela do relato. */
  function registrarTelaDaCaptura(tela: string) {
    setRascunho((r) =>
      r
        ? {
            ...r,
            tela: r.telaEditada ? r.tela : tela,
            modulo: r.moduloEditado ? r.modulo : (moduloDaTela(tela) ?? r.modulo),
          }
        : r
    );
  }

  async function capturarPelaBarra(comTempo = false) {
    if (!rascunho) return;
    toast.dismiss();
    setCapturando(true);
    const tela = pathname;
    const r = await capturarTela({
      nome: nomeDaCaptura(new Date(), tela),
      // Com tempo é sempre a TELA INTEIRA: lista de seleção aberta não é
      // desenho da aba, e na foto da aba ela simplesmente não existe.
      origem: comTempo ? "tela-inteira" : "esta-aba",
      esconder: () => setEscondido(true),
      mostrar: () => setEscondido(false),
      contagem: comTempo ? SEGUNDOS_DA_CONTAGEM : 0,
      aoContar: setFaltam,
    });
    setCapturando(false);
    setFaltam(0);
    if (!r.ok) {
      avisarFalhaDaCaptura(r.motivo);
      return;
    }
    const { novos, avisos } = montarPendentes([r.arquivo], "captura", rascunho.anexos.length);
    avisos.forEach((a) => toast.warning(a));
    if (novos.length === 0) return;
    setRascunho((atual) => (atual ? { ...atual, anexos: [...atual.anexos, ...novos] } : atual));
    registrarTelaDaCaptura(tela);
    if (comTempo && r.superficie && r.superficie !== "monitor") {
      avisarCaptura(true, r.superficie);
    } else {
      toast.success("Tela capturada.", {
        description: "Capture outras telas, se precisar, ou volte ao relato.",
      });
    }
  }

  // Na própria tela de Problemas o formulário já está na página: ali a boia
  // continua sendo o atalho para a lista.
  const naTelaDeProblemas =
    pathname === "/problemas" || pathname.startsWith("/problemas/");

  const icone = (
    <>
      <LifeBuoy className="size-[18px]" />
      <span className="sr-only">Relatar um problema</span>
      {pendentes > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-medium tabular-nums text-gold-foreground">
          {pendentes > 99 ? "99+" : pendentes}
        </span>
      )}
    </>
  );
  const classeDoIcone =
    "relative grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground";

  const aviso = isAdminMaster
    ? pendentes === 0
      ? "Nenhum relato esperando por você."
      : `${pendentes === 1 ? "1 relato espera" : `${pendentes} relatos esperam`} por você.`
    : pendentes === 0
      ? "Acompanhe seus relatos e as respostas."
      : `Você tem ${pendentes === 1 ? "1 resposta nova" : `${pendentes} respostas novas`}.`;

  const prints = rascunho?.anexos.filter((a) => a.kind === "captura").length ?? 0;
  const cheio = (rascunho?.anexos.length ?? 0) >= MAXIMO_POR_ENVIO;

  return (
    <>
      {naTelaDeProblemas ? (
        <Link href="/problemas" title="Problemas relatados" className={classeDoIcone}>
          {icone}
        </Link>
      ) : null}

      <DialogPrimitive.Root open={aberto} onOpenChange={abrir}>
        {!naTelaDeProblemas && (
          <DialogPrimitive.Trigger title="Relatar um problema" className={classeDoIcone}>
            {icone}
          </DialogPrimitive.Trigger>
        )}
        {/* `keepMounted`: fechar o painel não apaga o que foi escrito. */}
        <DialogPrimitive.Portal keepMounted>
          <DialogPrimitive.Backdrop
            className={cn(
              "fixed inset-0 z-50 bg-black/20 data-open:animate-in data-open:fade-in-0 data-closed:hidden",
              escondido && "invisible"
            )}
          />
          {/*
            ⚠️ O PAINEL FICA AO LADO, NÃO NO MEIO: a tela do problema continua
            à vista enquanto a pessoa escreve — e é ela que a captura fotografa.
            `data-moldura`: não sai na impressão.
          */}
          <DialogPrimitive.Popup
            data-moldura
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-background shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-right-8 data-closed:hidden",
              escondido && "invisible"
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold">
                  Relatar um problema
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                  {rascunho && rascunho.origem !== pathname ? (
                    <>
                      Relato começado em{" "}
                      <span className="font-mono">{rascunho.origem}</span> · agora em{" "}
                      <span className="font-mono">{pathname}</span>
                    </>
                  ) : (
                    <>
                      Nesta tela: <span className="font-mono">{pathname}</span>
                    </>
                  )}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Fechar (o rascunho fica guardado)"
                title="Fechar — o que você escreveu fica guardado"
              >
                <XIcon className="size-4" />
              </DialogPrimitive.Close>
            </div>

            <Link
              href="/problemas"
              onClick={() => setAberto(false)}
              className={cn(
                "flex items-center justify-between gap-2 border-b px-4 py-2.5 text-sm hover:bg-muted/60",
                pendentes > 0 && "bg-gold/10 font-medium"
              )}
            >
              <span>{aviso}</span>
              <span className="flex shrink-0 items-center gap-1 text-primary">
                Ver relatos
                <ArrowRight className="size-4" />
              </span>
            </Link>

            <div className="flex-1 overflow-y-auto p-4">
              {!temUnidade ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Escolha uma unidade no menu lateral para registrar — o relato
                  pertence à unidade em que aconteceu.
                </p>
              ) : rascunho ? (
                <FormularioDeRelato
                  key={rascunho.chave}
                  telaSugerida={rascunho.origem}
                  digestSugerido=""
                  versaoAtual={APP_VERSION}
                  iniciais={rascunho.iniciais}
                  silencioso
                  esconder={() => setEscondido(true)}
                  mostrar={() => setEscondido(false)}
                  controle={{
                    anexos: rascunho.anexos,
                    aoMudarAnexos: (anexos) =>
                      setRascunho((r) => (r ? { ...r, anexos } : r)),
                    tela: rascunho.tela,
                    aoMudarTela: (tela) =>
                      setRascunho((r) => (r ? { ...r, tela, telaEditada: true } : r)),
                    modulo: rascunho.modulo,
                    aoMudarModulo: (modulo) =>
                      setRascunho((r) => (r ? { ...r, modulo, moduloEditado: true } : r)),
                    aoIrAteATela: () => {
                      setModoCaptura(true);
                      setAberto(false);
                    },
                    telaAtual: pathname,
                    aoCapturarEstaTela: () => registrarTelaDaCaptura(pathname),
                  }}
                  aoCancelar={() => {
                    descartar();
                    setAberto(false);
                  }}
                  aoRegistrar={(codigo) => {
                    setAberto(false);
                    setRascunho(null);
                    window.dispatchEvent(new Event(RELATOS_VISTOS));
                    toast.success(`Registrado como ${codigo}.`, {
                      description: "A resposta chega pela boia, aqui em cima.",
                      action: {
                        label: "Abrir",
                        onClick: () => router.push(`/problemas/${codigo}`),
                      },
                    });
                  }}
                />
              ) : null}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {modoCaptura && rascunho && createPortal(
        // A BARRA DO MODO DE CAPTURA. Fica acima de tudo, some na hora da foto
        // e não sai na impressão. O ESTADO mora aqui, na barra de cima, porque
        // é o único lugar do sistema que continua montado quando a pessoa
        // troca de tela.
        //
        // ⚠️ MAS O DESENHO VAI PARA O `body` (portal). A barra de cima tem
        // `backdrop-blur`, e um elemento com filtro vira a referência de todo
        // `position: fixed` dentro dele: desenhada ali, a barra "do rodapé"
        // apareceu cortada no alto da tela.
        <div
          data-moldura
          role="region"
          aria-label="Modo de captura de tela"
          className={cn(
            "fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border-2 border-gold bg-background px-3 py-2.5 shadow-2xl sm:inset-x-6",
            escondido && "invisible"
          )}
        >
          <Camera className="size-5 shrink-0 text-gold-forte" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Vá até a tela do problema e clique em Capturar.</p>
            <p className="text-xs text-muted-foreground">
              Use o menu normalmente — o relato está guardado.{" "}
              {prints === 0
                ? "Nenhum print ainda."
                : prints === 1
                  ? "1 print tirado."
                  : `${prints} prints tirados.`}
              {cheio && ` Limite de ${MAXIMO_POR_ENVIO} anexos atingido.`}
              {!cheio && (
                <>
                  {" "}
                  <strong className="text-foreground">Com tempo</strong> serve
                  para mostrar lista ou menu <em>aberto</em>: escolha Tela
                  inteira e abra durante a contagem.
                </>
              )}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => capturarPelaBarra(false)}
            disabled={capturando || cheio}
          >
            <Camera className="mr-1.5 size-4" />
            {capturando ? "Capturando…" : "Capturar"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => capturarPelaBarra(true)}
            disabled={capturando || cheio}
            title={`Para mostrar lista, menu ou calendário ABERTO: escolha "Tela inteira" e abra o que quer mostrar durante os ${SEGUNDOS_DA_CONTAGEM} segundos`}
          >
            <Timer className="mr-1.5 size-4" />
            Com tempo
          </Button>
          <Button size="sm" variant="outline" onClick={() => abrir(true)} disabled={capturando}>
            <Undo2 className="mr-1.5 size-4" />
            Voltar ao relato
          </Button>
        </div>,
        document.body
      )}
      <ContagemDaFoto faltam={faltam} />
    </>
  );
}
