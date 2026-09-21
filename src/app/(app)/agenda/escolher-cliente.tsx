"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buscarClientesParaAgendar, type ClienteParaAgendar } from "./actions";

/**
 * ESCOLHER O CLIENTE DIGITANDO (relato OC-00063, 21/09/2026).
 *
 * Antes era uma lista pronta para rolar. Na clínica com mil cadastros isso é
 * inviável — e era pior do que parecia: a tela da agenda carregava **no máximo
 * 300 nomes**, então o paciente procurado podia não estar ali, sem nenhum aviso.
 * Quem está no balcão conclui que a pessoa não tem cadastro e cadastra de novo.
 *
 * Aqui a pessoa digita, e a busca vai ao servidor alcançar a unidade inteira
 * (nome, código ou CPF). A lista que a página já carregou continua servindo
 * para uma coisa: aparecer ANTES de digitar, para a unidade pequena continuar
 * escolhendo com dois cliques, como antes.
 *
 * Três cuidados copiados da busca rápida, porque já foram aprendidos lá:
 * espera de 250 ms antes de ir ao servidor (senão é uma ida por tecla),
 * descarte da resposta que chega fora de ordem, e navegação por setas — quem
 * trabalha no balcão não tira a mão do teclado.
 */
export function EscolherCliente({
  clinicId,
  sugestoes,
  valor,
  aoEscolher,
  desabilitado,
}: {
  /** A unidade do agendamento — a busca não atravessa unidade. */
  clinicId: string;
  /** Os primeiros nomes que a página já trouxe, para a lista inicial. */
  sugestoes: { id: string; full_name: string; inactive?: boolean }[];
  valor: string;
  aoEscolher: (id: string) => void;
  desabilitado?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<ClienteParaAgendar[]>([]);
  const [marcado, setMarcado] = useState(0);
  const [buscando, iniciar] = useTransition();
  const pedido = useRef(0);

  const escolhido = valor
    ? (sugestoes.find((c) => c.id === valor) ??
      (() => {
        const a = achados.find((c) => c.id === valor);
        return a ? { id: a.id, full_name: a.fullName, inactive: a.inactive } : null;
      })())
    : null;

  useEffect(() => {
    const texto = termo.trim();
    if (texto.length < 2 || !clinicId) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      iniciar(async () => {
        const lista = await buscarClientesParaAgendar(texto, clinicId);
        if (meu !== pedido.current) return; // resposta atrasada: descarta
        setAchados(lista);
        setMarcado(0);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [termo, clinicId]);

  const procurando = termo.trim().length >= 2;
  const visiveis: ClienteParaAgendar[] = procurando
    ? achados
    : sugestoes.slice(0, 8).map((c) => ({
        id: c.id,
        fullName: c.full_name,
        code: null,
        inactive: Boolean(c.inactive),
      }));

  function escolher(id: string) {
    aoEscolher(id);
    setTermo("");
    setAchados([]);
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
      // Enter aqui escolhe o cliente; sem isto ele enviaria o formulário pela
      // metade, que era o jeito mais fácil de agendar para a pessoa errada.
      e.preventDefault();
      const alvo = visiveis[marcado];
      if (alvo) escolher(alvo.id);
    }
  }

  if (escolhido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {escolhido.full_name}
          {escolhido.inactive && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              (inativo)
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => aoEscolher("")}
          disabled={desabilitado}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Trocar de cliente"
          aria-label="Trocar de cliente"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={aoNavegar}
          disabled={desabilitado}
          autoComplete="off"
          placeholder="Digite o nome, o código ou o CPF"
          aria-label="Procurar o cliente"
          className="pl-8"
        />
      </div>

      <ul className="max-h-56 overflow-y-auto rounded-md border">
        {visiveis.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => escolher(c.id)}
              onMouseEnter={() => setMarcado(i)}
              className={cn(
                "flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                i === marcado && "bg-muted"
              )}
            >
              <span className="min-w-0 flex-1 truncate">{c.fullName}</span>
              {c.code && (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {c.code}
                </span>
              )}
              {c.inactive && (
                <span className="shrink-0 text-[11px] text-muted-foreground">inativo</span>
              )}
            </button>
          </li>
        ))}

        {visiveis.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            {buscando
              ? "Procurando…"
              : procurando
                ? "Nenhum cliente encontrado nesta unidade."
                : "Nenhum cliente cadastrado nesta unidade ainda."}
          </li>
        )}
      </ul>

      {/* A frase muda conforme o que está acontecendo: antes de digitar ela
          avisa que a lista é só o começo — era justamente isso que faltava
          quando a lista vinha cortada em silêncio. */}
      <p className="text-xs text-muted-foreground">
        {/* Sem unidade a busca não teria onde procurar. Dizer isso é melhor do
            que devolver uma lista vazia, que a pessoa leria como "não existe". */}
        {!clinicId
          ? "Escolha a unidade primeiro — é nela que o cliente é procurado."
          : procurando
            ? "Procurando em toda a unidade."
            : "Mostrando os primeiros nomes — digite para procurar entre todos."}
      </p>
    </div>
  );
}
