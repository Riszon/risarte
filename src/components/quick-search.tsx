"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PHASE_LABELS } from "@/lib/journey";
import { buscarProntuarios, type ClienteEncontrado } from "@/app/(app)/busca-actions";

/**
 * BUSCA RÁPIDA DE PRONTUÁRIOS — o botão que está sempre lá.
 *
 * Quem trabalha no balcão procura paciente o dia inteiro, e até aqui isso
 * custava: abrir Prontuários, esperar a lista, filtrar. Agora é um clique (ou
 * Ctrl+K) de qualquer tela.
 *
 * DUAS DECISÕES QUE MOLDAM O COMPORTAMENTO:
 *
 * 1. **Espera 250ms antes de perguntar ao banco.** Quem digita "Mariana" faria
 *    sete buscas; com a pausa, faz uma. Não é economia de servidor — é a lista
 *    parar de pular embaixo do dedo enquanto a pessoa ainda está escrevendo.
 *
 * 2. **A resposta velha é descartada.** Buscas voltam fora de ordem: a de "ma"
 *    pode chegar depois da de "maria" e sobrescrever o resultado certo com o
 *    errado. Cada busca leva um número, e só a mais recente pode escrever na
 *    tela.
 */
export function QuickSearch() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [itens, setItens] = useState<ClienteEncontrado[]>([]);
  const [marcado, setMarcado] = useState(0);
  const [buscando, iniciar] = useTransition();
  const pedido = useRef(0);

  // Ctrl+K (ou ⌘K) de qualquer lugar. Não rouba a tecla de dentro de um campo
  // de texto — quem está escrevendo uma anamnese não quer a busca abrindo.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAberto(true);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const texto = termo.trim();
    // Não limpa a lista aqui: quem decide o que aparece é `visiveis`, logo
    // abaixo. Apagar estado de dentro do efeito faz o React desenhar duas
    // vezes à toa — e o resultado na tela seria o mesmo.
    if (texto.length < 2) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      iniciar(async () => {
        const achados = await buscarProntuarios(texto);
        // Chegou uma resposta de uma busca que já não é a atual: descarta.
        if (meu !== pedido.current) return;
        setItens(achados);
        setMarcado(0);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto]);

  // O que a tela mostra é DERIVADO do que está digitado: apagar até sobrar uma
  // letra esconde os resultados na hora, sem esperar busca nenhuma.
  const visiveis = termo.trim().length >= 2 ? itens : [];

  function abrir(cliente: ClienteEncontrado) {
    setAberto(false);
    setTermo("");
    setItens([]);
    router.push(`/prontuarios/${cliente.id}`);
  }

  function aoNavegar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (visiveis.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarcado((m) => (m + 1) % visiveis.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarcado((m) => (m - 1 + visiveis.length) % visiveis.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      abrir(visiveis[marcado]);
    }
  }

  return (
    <>
      {/* Parece um campo, mas é um botão: o campo de verdade vive na janela que
          abre, com foco automático. Assim não há dois lugares para digitar. */}
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Procurar prontuário (Ctrl + K)"
        className="flex w-full max-w-sm items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">
          Procurar paciente
          <span className="hidden sm:inline"> — nome, código ou CPF</span>
        </span>
        {/* O atalho fica escrito: atalho que ninguém descobre não existe. */}
        <kbd className="ml-auto hidden shrink-0 rounded border px-1 text-[10px] md:inline">
          Ctrl K
        </kbd>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Procurar prontuário</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={aoNavegar}
              placeholder="Nome, código ou CPF"
              className="border-0 shadow-none focus-visible:ring-0"
              aria-label="Procurar prontuário por nome, código ou CPF"
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {termo.trim().length < 2 ? (
              <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                Digite pelo menos 2 letras — ou 3 números do CPF.
              </p>
            ) : visiveis.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                {buscando ? "Procurando…" : "Nenhum paciente encontrado."}
              </p>
            ) : (
              <ul>
                {visiveis.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => abrir(c)}
                      onMouseEnter={() => setMarcado(i)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left",
                        i === marcado ? "bg-muted" : "hover:bg-muted/60"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.fullName}
                        </span>
                        {/* O código nunca some — aqui ele é o que separa dois
                            homônimos sem precisar abrir as duas fichas. */}
                        {c.code && (
                          <span className="shrink-0 rounded border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
                            {c.code}
                          </span>
                        )}
                        {c.status === "inactive" && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                            inativo
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.clinicName} · {PHASE_LABELS[c.journeyPhase]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            ↑ ↓ para escolher · Enter para abrir · Esc para fechar
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
