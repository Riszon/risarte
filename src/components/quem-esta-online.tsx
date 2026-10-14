"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Radio } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  SITUACAO_EXPLICA,
  detalheDaPessoa,
  horaDe,
  lerPresenca,
  lerResumo,
  nomeDaTela,
  porSituacao,
  rotuloDasFuncoes,
  type PessoaNaPresenca,
  type ResumoDaPresenca,
} from "@/lib/quem-esta-online";

/** De quanto em quanto tempo o número da barra é conferido. */
const CONFERIR_O_NUMERO_MS = 60_000;
/** Com a lista aberta, ela se atualiza mais depressa. */
const CONFERIR_A_LISTA_MS = 30_000;

/**
 * QUEM ESTÁ ONLINE, na barra de cima (0291, pedido do dono em 13/10/2026).
 *
 * Só o Admin Master vê — a barra só desenha este item para ele, e o banco
 * repete a regra: para qualquer outra pessoa as duas consultas devolvem vazio.
 *
 * ⚠️ O NÚMERO VEM DE UMA CONSULTA PRÓPRIA (`presence_summary`), e não da lista
 * contada aqui. A lista só é buscada quando a janela abre; contar o que veio
 * daria zero com a janela fechada, e passaria a mentir no dia em que a API
 * cortasse a resposta (AP35).
 *
 * ⚠️ SEM RESPOSTA, NÃO DESENHA NADA. Entre a publicação e o dia em que a
 * migração 0291 roda, as consultas não existem; um "0 online" ali seria a tela
 * afirmando o que ela não mediu.
 *
 * As consultas vão direto do navegador ao banco, como o contador do Chat: uma
 * ação de servidor por minuto entraria na fila de navegação do Next e
 * atrasaria os cliques de quem está trabalhando (OC-00093).
 */
export function QuemEstaOnline() {
  const [resumo, setResumo] = useState<ResumoDaPresenca | null>(null);
  const [aberto, setAberto] = useState(false);
  const [pessoas, setPessoas] = useState<PessoaNaPresenca[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [lidoEm, setLidoEm] = useState<number | null>(null);

  const lerNumero = useCallback(() => {
    void createClient()
      .rpc("presence_summary")
      .then(({ data, error }) => {
        // Erro (função ainda não existe, rede caiu): mantém o que já havia.
        if (!error) setResumo(lerResumo(data));
      });
  }, []);

  const lerLista = useCallback(() => {
    void createClient()
      .rpc("presence_now", { p_grupo: "conectados" })
      .then(({ data, error }) => {
        const lidas = error ? null : lerPresenca(data);
        if (lidas === null) {
          // Lista que não veio NÃO vira "ninguém online": a janela diz que
          // não conseguiu ler e mantém a última que tinha.
          setFalhou(true);
          return;
        }
        setFalhou(false);
        setPessoas(lidas);
        setLidoEm(Date.now());
      });
  }, []);

  useEffect(() => {
    lerNumero();
    const relogio = setInterval(() => {
      // Aba escondida não pergunta: ninguém está olhando o número.
      if (document.visibilityState === "visible") lerNumero();
    }, CONFERIR_O_NUMERO_MS);
    const voltou = () => {
      if (document.visibilityState === "visible") lerNumero();
    };
    document.addEventListener("visibilitychange", voltou);
    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", voltou);
    };
  }, [lerNumero]);

  useEffect(() => {
    if (!aberto) return;
    lerLista();
    lerNumero();
    const relogio = setInterval(() => {
      lerLista();
      lerNumero();
    }, CONFERIR_A_LISTA_MS);
    return () => clearInterval(relogio);
  }, [aberto, lerLista, lerNumero]);

  if (!resumo) return null;

  const grupos = pessoas ? porSituacao(pessoas) : null;
  const rotulo = `Quem está online: ${resumo.online} online, ${resumo.ausentes} ausente(s)`;

  return (
    <>
      <button
        type="button"
        title={rotulo}
        onClick={() => setAberto(true)}
        className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Radio className="size-[18px]" />
        <span className="sr-only">{rotulo}</span>
        {/* O número aparece SEMPRE, inclusive o zero: aqui "ninguém online" é
            uma resposta, não ausência de aviso. */}
        <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-medium text-white tabular-nums">
          {resumo.online > 99 ? "99+" : resumo.online}
        </span>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quem está online</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            {resumo.online} online · {resumo.ausentes} ausente(s) ·{" "}
            {resumo.sairam} entraram hoje e não estão conectados ·{" "}
            {resumo.naoEntraram} ainda não entraram hoje.
            {lidoEm ? ` Atualizado às ${horaDe(new Date(lidoEm).toISOString())}.` : ""}
          </p>

          {falhou && (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              Não foi possível atualizar a lista agora.
              {pessoas ? " O que aparece abaixo é a última leitura." : ""}
            </p>
          )}

          {grupos === null || lidoEm === null ? (
            !falhou && <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-4">
              <Grupo
                titulo="Online"
                explica={SITUACAO_EXPLICA.online}
                pessoas={grupos.online}
                cor="bg-emerald-500"
                vazio="Ninguém online agora."
                agoraMs={lidoEm}
              />
              <Grupo
                titulo="Ausentes"
                explica={SITUACAO_EXPLICA.ausente}
                pessoas={grupos.ausente}
                cor="bg-amber-500"
                vazio="Ninguém ausente."
                agoraMs={lidoEm}
              />
            </div>
          )}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Só o Admin Master vê esta lista.{" "}
            <Link
              href="/admin/auditoria?visao=online"
              className="underline underline-offset-2"
              onClick={() => setAberto(false)}
            >
              Ver também quem saiu e quem não entrou hoje
            </Link>
            .
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Grupo({
  titulo,
  explica,
  pessoas,
  cor,
  vazio,
  agoraMs,
}: {
  titulo: string;
  explica: string;
  pessoas: PessoaNaPresenca[];
  cor: string;
  vazio: string;
  agoraMs: number;
}) {
  return (
    <section className="space-y-1.5">
      <p className="text-sm font-medium" title={explica}>
        {titulo} ({pessoas.length})
      </p>
      {pessoas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="space-y-1.5">
          {pessoas.map((p) => {
            const tela = nomeDaTela(p.tela);
            return (
              <li key={p.id} className="flex gap-2 rounded-md border p-2 text-sm">
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", cor)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{p.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rotuloDasFuncoes(p)}
                  </span>
                  <span className="block text-xs">
                    {tela ? `Em ${tela}` : "Tela não informada"}
                    <span className="text-muted-foreground">
                      {" · "}
                      {detalheDaPessoa(p, agoraMs)}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
