"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { GripVertical, Loader2, Maximize2, Minus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CLINICAL_BUCKET } from "@/lib/clinical";
import { recordClinicalMedia } from "@/app/(app)/prontuarios/[id]/clinical-actions";
import { atendimentoAindaAberto } from "@/app/(app)/agenda/actions";
import {
  CONFERIR_ATENDIMENTO_S,
  GRAVACAO_INICIAR,
  GRAVACAO_PARAR,
  LIMITE_DE_GRAVACAO_S,
  extensaoDe,
  formatoDisponivel,
  assinarJeitoDaFaixa,
  guardarFaixaEncolhida,
  guardarLugarDaFaixa,
  jeitoDaFaixa,
  jeitoNoServidor,
  limitarNaJanela,
  marcarGravacao,
  relogio,
  type PedidoDeGravacao,
} from "@/lib/gravacao";

/**
 * A GRAVAÇÃO DA CONSULTA, QUE ATRAVESSA AS TELAS (relato OC-00060).
 *
 * Mora aqui, junto da barra de cima, e não na tela da avaliação, porque este é
 * o único lugar que continua montado quando o Coordenador navega — e a consulta
 * inteira é navegar: ficha, anamnese, fotos, considerações. Na tela, a gravação
 * seria cortada em pedaços a cada clique de menu.
 *
 * ⚠️ A FAIXA É VISÍVEL DE PROPÓSITO (decisão do dono, 21/09/2026). O jurídico
 * dispensou o consentimento formal para o áudio da avaliação, mas dispensar a
 * papelada não é o mesmo que gravar sem a pessoa saber: a faixa fica à vista,
 * com o tempo correndo, de onde o paciente na cadeira enxerga.
 *
 * ⚠️ O QUE O NAVEGADOR EXIGE. `getUserMedia` só abre o microfone com permissão;
 * na PRIMEIRA vez em cada computador ele pergunta, e a pergunta só aparece se
 * houver um gesto da pessoa. Por isso o começo está pendurado no clique de
 * "Chamar" e no de "Iniciar a avaliação" — não numa abertura de tela sozinha.
 * Negada a permissão, o sistema DIZ (não fica em silêncio fingindo que grava).
 */
export function GravacaoDaConsulta() {
  const [pedido, setPedido] = useState<PedidoDeGravacao | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const trilha = useRef<MediaStream | null>(null);
  const relogioRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const formato = useRef<string>("audio/webm");
  // O pedido também num ref: o `onstop` do MediaRecorder é criado uma vez e
  // enxergaria o estado velho (o clássico da closure) — e aí a gravação seria
  // salva na ficha do paciente ANTERIOR.
  const emCurso = useRef<PedidoDeGravacao | null>(null);
  // `parar` nasce depois de `comecar`; o ref evita a dependência circular.
  const pararRef = useRef<(() => void) | null>(null);

  // ---- Onde a faixa fica (relato OC-00069) ---------------------------------
  // `null` = o canto de baixo à direita, o lugar padrão. Quem arrasta ganha uma
  // posição própria, guardada NESTE navegador: é conveniência de quem usa, não
  // dado do sistema — e ela volta ao canto sozinha se a janela encolher.
  const { lugar, encolhida } = useSyncExternalStore(
    assinarJeitoDaFaixa,
    jeitoDaFaixa,
    jeitoNoServidor
  );
  const [arrastando, setArrastando] = useState(false);
  const faixaRef = useRef<HTMLDivElement | null>(null);
  const agarre = useRef<{ dx: number; dy: number } | null>(null);

  /** Arrastar pela alça: o corpo inteiro faria o clique em "Parar" virar arrasto. */
  const comecarArrasto = useCallback(
    (e: React.PointerEvent) => {
      const caixa = faixaRef.current?.getBoundingClientRect();
      if (!caixa) return;
      agarre.current = { dx: e.clientX - caixa.left, dy: e.clientY - caixa.top };
      setArrastando(true);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    []
  );

  useEffect(() => {
    if (!arrastando) return;
    function mover(e: PointerEvent) {
      const caixa = faixaRef.current?.getBoundingClientRect();
      const pega = agarre.current;
      if (!caixa || !pega) return;
      guardarLugarDaFaixa(
        limitarNaJanela(
          { x: e.clientX - pega.dx, y: e.clientY - pega.dy },
          { largura: caixa.width, altura: caixa.height },
          { largura: window.innerWidth, altura: window.innerHeight }
        )
      );
    }
    function soltar() {
      agarre.current = null;
      setArrastando(false);
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [arrastando]);

  // A janela mudou de tamanho: a posição de ontem, num monitor grande, deixaria
  // a faixa fora da tela no notebook de hoje — e com ela o botão de parar.
  useEffect(() => {
    if (!lugar) return;
    function recolocar() {
      const caixa = faixaRef.current?.getBoundingClientRect();
      if (!caixa || !lugar) return;
      const dentro = limitarNaJanela(
        lugar,
        { largura: caixa.width, altura: caixa.height },
        { largura: window.innerWidth, altura: window.innerHeight }
      );
      if (dentro.x !== lugar.x || dentro.y !== lugar.y) guardarLugarDaFaixa(dentro);
    }
    window.addEventListener("resize", recolocar);
    return () => window.removeEventListener("resize", recolocar);
  }, [lugar]);

  const soltarMicrofone = useCallback(() => {
    if (relogioRef.current) clearInterval(relogioRef.current);
    relogioRef.current = null;
    trilha.current?.getTracks().forEach((t) => t.stop());
    trilha.current = null;
  }, []);

  /** Guarda o que foi gravado. Roda no `onstop`, inclusive no fim automático. */
  const guardar = useCallback(async () => {
    const alvo = emCurso.current;
    const mime = formato.current;
    const blob = new Blob(pedacos.current, { type: mime });
    pedacos.current = [];
    emCurso.current = null;
    if (!alvo || blob.size === 0) {
      setSalvando(false);
      return;
    }
    setSalvando(true);
    const supabase = createBrowserClient();
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const nome = `consulta-${carimbo}.${extensaoDe(mime)}`;
    const caminho = `${alvo.clinicId}/${alvo.clientId}/${crypto.randomUUID()}-${nome}`;
    const { error: erroUpload } = await supabase.storage
      .from(CLINICAL_BUCKET)
      .upload(caminho, blob, { contentType: mime });
    if (erroUpload) {
      setSalvando(false);
      toast.error(`Falha ao enviar a gravação: ${erroUpload.message}`);
      return;
    }
    const r = await recordClinicalMedia(alvo.clientId, {
      kind: "audio",
      storagePath: caminho,
      originalName: nome,
      contentType: mime,
      sizeBytes: blob.size,
    });
    setSalvando(false);
    if (r.ok) {
      toast.success(`Gravação de ${alvo.clientName} salva na ficha.`);
    } else {
      toast.error(r.error ?? "Não foi possível registrar a gravação.");
      // Arquivo sem registro é arquivo órfão: ninguém acha, e ele fica
      // ocupando espaço com dado de paciente dentro.
      await supabase.storage.from(CLINICAL_BUCKET).remove([caminho]);
    }
  }, []);

  const parar = useCallback(() => {
    const g = gravador.current;
    gravador.current = null;
    marcarGravacao(null);
    setPedido(null);
    setSegundos(0);
    if (g && g.state !== "inactive") g.stop(); // o `onstop` guarda
    else void guardar();
    soltarMicrofone();
  }, [guardar, soltarMicrofone]);

  const comecar = useCallback(
    async (novo: PedidoDeGravacao) => {
      if (gravador.current) return; // já está gravando: um de cada vez
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        toast.error("Este navegador não permite gravar áudio.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        trilha.current = stream;
        const mime = formatoDisponivel();
        formato.current = mime ?? "audio/webm";
        const g = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        pedacos.current = [];
        emCurso.current = novo;
        g.ondataavailable = (e) => {
          if (e.data.size > 0) pedacos.current.push(e.data);
        };
        g.onstop = () => void guardar();
        gravador.current = g;
        g.start();
        marcarGravacao(novo.clientId); // as telas param de oferecer um 2º gravador
        setPedido(novo);
        setSegundos(0);
        // O teto é conferido AQUI, onde o tempo anda — checá-lo num efeito
        // que reage ao próprio estado é pedir para o React desenhar duas
        // vezes (e o lint reprova, com razão).
        relogioRef.current = setInterval(() => {
          setSegundos((s) => {
            if (s + 1 >= LIMITE_DE_GRAVACAO_S) {
              toast.warning("Gravação encerrada por tempo (2 horas). O áudio foi salvo.");
              queueMicrotask(() => pararRef.current?.());
            }
            return s + 1;
          });
        }, 1000);
        toast.info(`Gravando a consulta de ${novo.clientName}.`, {
          description: "Para sozinha ao concluir o atendimento.",
        });
      } catch {
        soltarMicrofone();
        toast.error(
          "Não consegui ligar o microfone — a consulta NÃO está sendo gravada.",
          {
            description:
              "Permita o microfone na barra de endereço do navegador e chame o paciente de novo, ou grave pelo botão da ficha.",
            duration: 10_000,
          }
        );
      }
    },
    [guardar, soltarMicrofone]
  );

  // O ref é atualizado em efeito (nunca durante o desenho) — é ele que o
  // relógio usa para encerrar no teto sem depender de uma função que ainda
  // não existia quando ele foi criado.
  useEffect(() => {
    pararRef.current = parar;
  }, [parar]);

  // Quem pede para começar e para parar.
  useEffect(() => {
    function aoIniciar(e: Event) {
      void comecar((e as CustomEvent<PedidoDeGravacao>).detail);
    }
    function aoParar(e: Event) {
      const alvo = (e as CustomEvent<{ appointmentId: string | null }>).detail;
      // Um atendimento não encerra a gravação de outro.
      const atual = emCurso.current;
      if (!atual) return;
      if (alvo?.appointmentId && atual.appointmentId && alvo.appointmentId !== atual.appointmentId) {
        return;
      }
      parar();
    }
    window.addEventListener(GRAVACAO_INICIAR, aoIniciar);
    window.addEventListener(GRAVACAO_PARAR, aoParar);
    return () => {
      window.removeEventListener(GRAVACAO_INICIAR, aoIniciar);
      window.removeEventListener(GRAVACAO_PARAR, aoParar);
    };
  }, [comecar, parar]);

  /**
   * A REDE DE SEGURANÇA: e se o atendimento for concluído em OUTRA tela?
   *
   * O fim pode ser clicado no painel de Atendimento, em outra aba, ou por outra
   * pessoa. O evento só atravessa a aba atual, então de minuto em minuto se
   * pergunta ao banco se aquele atendimento ainda está aberto. Sem isto, a
   * gravação seguiria correndo depois de o paciente ter ido embora — e o
   * relato que originou tudo isto é justamente sobre esquecer de parar.
   */
  useEffect(() => {
    const id = pedido?.appointmentId;
    if (!id) return;
    const t = setInterval(async () => {
      const aberto = await atendimentoAindaAberto(id).catch(() => true);
      if (!aberto) {
        toast.info("Atendimento concluído — a gravação foi salva.");
        parar();
      }
    }, CONFERIR_ATENDIMENTO_S * 1000);
    return () => clearInterval(t);
  }, [pedido?.appointmentId, parar]);

  // Fechar a aba no meio perderia o áudio: avisa antes.
  useEffect(() => {
    if (!pedido) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [pedido]);

  if (!pedido && !salvando) return null;
  if (typeof document === "undefined") return null;

  const estilo: React.CSSProperties = lugar
    ? { left: lugar.x, top: lugar.y, right: "auto", bottom: "auto" }
    : {};

  return createPortal(
    // Vai para o `body` pela mesma razão da barra de captura: a barra de cima
    // tem `backdrop-blur`, e qualquer `fixed` dentro dela vira posição relativa
    // àquele elemento — a faixa apareceria cortada.
    //
    // ⚠️ NASCE NO CANTO, NÃO NO MEIO (relato OC-00069). A primeira versão era
    // larga e centralizada no rodapé, exatamente onde moram os botões de ação
    // das telas clínicas — tapava o trabalho de quem ela deveria acompanhar.
    <div
      ref={faixaRef}
      data-moldura
      role="status"
      aria-live="polite"
      style={estilo}
      className={cn(
        "fixed z-50 flex items-center gap-2 rounded-xl border-2 border-destructive bg-background shadow-2xl",
        !lugar && "right-3 bottom-3 sm:right-6",
        encolhida ? "px-2 py-1.5" : "max-w-[min(28rem,calc(100vw-1.5rem))] px-3 py-2.5",
        arrastando && "cursor-grabbing select-none"
      )}
    >
      {salvando ? (
        <>
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Salvando a gravação na ficha…</p>
        </>
      ) : (
        <>
          {/* A ALÇA. Arrastar pelo corpo inteiro faria o clique em "Parar"
              virar arrasto por engano — e parar a gravação é o que mais
              importa acertar aqui. */}
          <button
            type="button"
            aria-label="Mover a faixa de gravação"
            title="Arraste para mover"
            onPointerDown={comecarArrasto}
            className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <GripVertical className="size-4" />
          </button>

          <span
            className="size-3 shrink-0 animate-pulse rounded-full bg-destructive"
            aria-hidden
          />

          {encolhida ? (
            // ENCOLHIDA AINDA MOSTRA QUE ESTÁ GRAVANDO: ponto vermelho e tempo.
            // A regra de 21/09 (nunca gravar escondido) não permite um estado
            // em que a faixa suma — só um em que ela ocupe pouco.
            <span className="text-sm font-medium tabular-nums">{relogio(segundos)}</span>
          ) : (
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                Gravando a consulta ·{" "}
                <span className="tabular-nums">{relogio(segundos)}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {pedido?.clientName} — para sozinha ao concluir o atendimento.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => guardarFaixaEncolhida(!encolhida)}
            aria-label={encolhida ? "Mostrar a faixa inteira" : "Encolher a faixa"}
            title={encolhida ? "Mostrar a faixa inteira" : "Encolher (continua gravando)"}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {encolhida ? <Maximize2 className="size-3.5" /> : <Minus className="size-4" />}
          </button>

          <Button
            size="sm"
            variant="outline"
            onClick={parar}
            className={cn("shrink-0", encolhida && "h-7 px-2")}
            title="Encerra a gravação e guarda o áudio na ficha"
          >
            <Square className={cn("size-3.5", !encolhida && "mr-1.5")} />
            {!encolhida && "Parar e salvar"}
          </Button>
        </>
      )}
    </div>,
    document.body
  );
}
