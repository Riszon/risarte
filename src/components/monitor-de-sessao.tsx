"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { todayInBrazil } from "@/lib/dates";
import { clienteGravando, relogio } from "@/lib/gravacao";
import {
  CONFERIR_DIA_A_CADA_MS,
  deveMandarSinal,
  lerEstadoDoAcesso,
  situacaoLocal,
} from "@/lib/acesso";

/** Onde as abas combinam entre si quando foi a última vez que a pessoa mexeu. */
const CHAVE = "risarte-ultima-atividade";

/**
 * O MONITOR DA SESSÃO (0287, pedido do dono em 09/10/2026).
 *
 * Três trabalhos, todos da TELA — a regra de verdade mora no banco:
 *
 * 1. **Sinal de atividade.** Quando a pessoa mexe (mouse, teclado, toque), a
 *    tela avisa o banco — no máximo uma vez por minuto. É desse sinal que saem
 *    o "tempo em uso" e o "tempo parado" da auditoria, e é por ele que o banco
 *    sabe que a pessoa continua ali.
 * 2. **Aviso antes de cair.** Nos últimos dois minutos do tempo de inatividade
 *    aparece a pergunta, com a contagem. Qualquer movimento cancela.
 * 3. **Encerrar.** No limite, ou quando a data muda, manda para a rota que
 *    encerra o acesso e registra o motivo.
 *
 * ⚠️ O SINAL VAI DIRETO DO NAVEGADOR PARA O BANCO, e não por uma ação do
 * servidor. Ação de servidor entra na fila de navegação do Next — foi essa
 * fila que cancelou o "Abrir" das notificações (OC-00093) e que nunca deixou o
 * login chegar à trilha. Um sinal por minuto nessa fila atrasaria os cliques
 * de quem está trabalhando.
 *
 * ⚠️ GRAVAÇÃO DE CONSULTA EM ANDAMENTO NÃO DESCONECTA (decisão do dono): o
 * dentista fica quarenta minutos sem tocar na tela. Enquanto a faixa
 * "Gravando" existir, o sinal segue e nada vence.
 *
 * ⚠️ VÁRIAS ABAS: a última atividade fica no `localStorage`, que todas as
 * abas leem — senão a aba parada desconectaria a pessoa que está trabalhando
 * na outra.
 *
 * Não desenha nada no servidor: o relógio de quem monta a página não é o de
 * quem a usa (lição do `useNow`).
 */
export function MonitorDeSessao({
  limiteMin,
  dia,
}: {
  /** Minutos sem uso até desconectar — o tempo da função desta pessoa. */
  limiteMin: number;
  /** A data (aaaa-mm-dd) em que este acesso começou. */
  dia: string;
}) {
  const [restam, setRestam] = useState<number | null>(null);
  const ultimaInteracao = useRef(0);
  const ultimoSinal = useRef(0);
  const saindo = useRef(false);
  /** Quando foi a última pergunta ao banco, e para qual data local ele disse "ok". */
  const ultimaPergunta = useRef(0);
  const diaConferido = useRef<string | null>(null);

  useEffect(() => {
    const agora = Date.now();
    // Abrir a tela é atividade: a pessoa acabou de chegar aqui.
    ultimaInteracao.current = agora;
    ultimoSinal.current = agora;

    const guardar = (ms: number) => {
      try {
        localStorage.setItem(CHAVE, String(ms));
      } catch {
        // janela anônima / armazenamento cheio: esta aba segue sozinha
      }
    };
    guardar(agora);

    function sair(motivo: "inatividade" | "virada_do_dia") {
      if (saindo.current) return;
      saindo.current = true;
      // `window.location`, nunca <Link>: o Next pré-carregaria a rota de saída.
      window.location.assign(`/auth/encerrar?motivo=${motivo}`);
    }

    function mexeu() {
      const t = Date.now();
      // Uma gravação no `localStorage` por segundo basta — mousemove não entra
      // na lista de propósito, mas rolar a página dispara em rajada.
      if (t - ultimaInteracao.current < 1000) return;
      ultimaInteracao.current = t;
      guardar(t);
    }

    function outraAba(e: StorageEvent) {
      if (e.key !== CHAVE || !e.newValue) return;
      const t = Number(e.newValue);
      if (Number.isFinite(t) && t > ultimaInteracao.current) ultimaInteracao.current = t;
    }

    /**
     * PERGUNTA AO BANCO se o acesso ainda vale — e só sai se ELE disser.
     *
     * Usada em dois momentos: quando a data deste computador é outra (o
     * relógio daqui pode estar errado; o do servidor é o que conta) e quando o
     * sinal de atividade volta dizendo que o acesso foi encerrado (para a tela
     * de login explicar o motivo certo).
     */
    function perguntarAoBanco(hojeAqui: string) {
      ultimaPergunta.current = Date.now();
      void createClient()
        .rpc("access_session_check")
        .then((resposta) => {
          const e = lerEstadoDoAcesso(resposta);
          if (!e) return; // sem resposta legível: ninguém é desconectado por isso
          if (e.estado === "virada_do_dia" || e.estado === "inatividade") {
            sair(e.estado);
          } else if (e.estado === "encerrada") {
            sair(e.motivo === "virada_do_dia" ? "virada_do_dia" : "inatividade");
          } else if (e.estado === "ok") {
            // O banco diz que o dia é o mesmo: o relógio DESTE computador é
            // que está diferente. Não pergunta de novo para esta data.
            diaConferido.current = hojeAqui;
          }
        });
    }

    function mandarSinal(gravando: boolean) {
      ultimoSinal.current = Date.now();
      void createClient()
        .rpc("access_session_touch", { p_gravando: gravando })
        .then(({ data }) => {
          // O banco encerrou (ou já tinha encerrado): descobre o motivo e sai.
          if (data === "encerrada") perguntarAoBanco(todayInBrazil());
        });
    }

    function conferir() {
      if (saindo.current) return;
      const t = Date.now();
      const gravando = clienteGravando() !== null;
      // ⚠️ A ABA QUE GRAVA AVISA AS OUTRAS. Gravação conta como atividade e
      // vai para o `localStorage`: sem isso, uma segunda aba aberta e parada
      // chegaria ao limite, sairia — e a saída derruba a sessão do navegador
      // inteiro, inclusive a da aba que está gravando a consulta.
      if (gravando) mexeu();
      const hojeAqui = todayInBrazil();
      const s = situacaoLocal({
        agoraMs: t,
        ultimaInteracaoMs: ultimaInteracao.current,
        limiteMin,
        diaDoAcesso: dia,
        hoje: hojeAqui,
        gravando,
      });
      if (s.tipo === "encerrar") {
        sair(s.motivo);
        return;
      }
      setRestam(s.tipo === "avisar" ? s.restamS : null);
      // A data daqui é outra: quem decide se o dia virou é o banco.
      if (
        s.conferirDia &&
        diaConferido.current !== hojeAqui &&
        t - ultimaPergunta.current >= CONFERIR_DIA_A_CADA_MS
      ) {
        perguntarAoBanco(hojeAqui);
      }
      if (
        deveMandarSinal({
          agoraMs: t,
          ultimaInteracaoMs: ultimaInteracao.current,
          ultimoSinalMs: ultimoSinal.current,
          gravando,
        })
      ) {
        mandarSinal(gravando);
      }
    }

    const eventos = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const ev of eventos) {
      window.addEventListener(ev, mexeu, { passive: true, capture: true });
    }
    window.addEventListener("storage", outraAba);
    // O computador que volta do descanso não espera o próximo segundo.
    document.addEventListener("visibilitychange", conferir);
    const relogioDaTela = setInterval(conferir, 1000);

    return () => {
      for (const ev of eventos) {
        window.removeEventListener(ev, mexeu, { capture: true });
      }
      window.removeEventListener("storage", outraAba);
      document.removeEventListener("visibilitychange", conferir);
      clearInterval(relogioDaTela);
    };
  }, [limiteMin, dia]);

  if (restam === null) return null;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Você ainda está aí?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            O sistema está sem uso. Por segurança, você será desconectado em{" "}
            <strong className="tabular-nums">{relogio(restam)}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            O limite da sua função é de {limiteMin} minutos sem clicar nem
            digitar. O que não foi salvo nesta tela se perde ao desconectar.
          </p>
          <div className="flex justify-end">
            {/* O clique já é atividade (o monitor ouve `pointerdown`): o botão
                só dá à pessoa um lugar óbvio para clicar. */}
            <Button autoFocus>Continuar conectado</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
