"use client";

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { atendeABusca } from "@/lib/busca";

// LISTA COM BUSCA (relato OC-00100, 14/10/2026).
//
// "Ao abrir a janela para selecionar, permite apenas a rolagem e seleção.
// Interessante ter uma lupa para digitar o nome do item que procura."
//
// O <select> do navegador não deixa procurar: numa lista de 60 contas ou 200
// itens de estoque, a pessoa rola até achar. Este componente faz o mesmo papel
// — escolher UM valor de uma lista —, com um campo de busca no alto da lista
// aberta. Por baixo é o Combobox da biblioteca de interface (Base UI), que já
// cuida de teclado, foco e leitor de tela.
//
// Uso igual ao do <select>: `value` + `onValueChange` (controlado) ou `name` +
// `defaultValue` (dentro de um <form>, o valor vai junto no envio). A opção
// sem valor (""), quando existe, aparece como a primeira e é o "nenhum".

export type OpcaoDaLista = {
  value: string;
  label: string;
  /** Texto extra só para a busca (código, CNPJ…) — não aparece. */
  busca?: string;
  disabled?: boolean;
};

type Props = {
  options: readonly OpcaoDaLista[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Nome no formulário: o valor escolhido vai no envio, como num <select>. */
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  /** Texto quando a busca não acha nada. */
  vazio?: string;
  /**
   * Escolheu, aplica: envia o formulário em volta (AP45). É o que o
   * `FilterForm` faz com o <select> nativo — sem isto, trocar a lista dentro
   * de um filtro não filtraria nada. Exige `name` (o valor vai no envio).
   */
  aplicaAoEscolher?: boolean;
};

export function ListaComBusca({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  placeholder = "Escolha…",
  disabled,
  required,
  id,
  className,
  "aria-label": ariaLabel,
  vazio = "Nada encontrado com essa busca.",
  aplicaAoEscolher = false,
}: Props) {
  const controlado = value !== undefined;
  const [interno, setInterno] = React.useState<string>(defaultValue ?? "");
  const atual = controlado ? value : interno;
  const escolhida = options.find((o) => o.value === atual) ?? null;
  // Ao abrir, o cursor vai para a BUSCA — senão o que a pessoa digita se perde.
  const buscaRef = React.useRef<HTMLInputElement>(null);
  const gatilhoRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Combobox.Root<OpcaoDaLista>
      items={options}
      value={escolhida}
      onValueChange={(o) => {
        const novo = o?.value ?? "";
        if (!controlado) setInterno(novo);
        onValueChange?.(novo);
        // Depois do desenho: o campo escondido com o valor novo já está no
        // formulário quando o filtro lê.
        if (aplicaAoEscolher) setTimeout(() => gatilhoRef.current?.form?.requestSubmit(), 0);
      }}
      itemToStringLabel={(o) => o.label}
      itemToStringValue={(o) => o.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
      filter={(o, busca) => atendeABusca(`${o.label} ${o.busca ?? ""}`, busca)}
      // A biblioteca diz pôr o cursor na busca ao abrir, e na tela não pôs
      // (nenhuma chamada de foco registrada). Aberta a lista, pomos nós.
      onOpenChangeComplete={(aberta) => {
        if (aberta) buscaRef.current?.focus();
      }}
      // Digitou, a primeira que atende fica destacada: Enter escolhe ela.
      autoHighlight
      name={name}
      disabled={disabled}
      required={required}
    >
      <Combobox.Trigger
        ref={gatilhoRef}
        id={id}
        aria-label={ariaLabel}
        // O cursor tem de ficar na BUSCA. Medido na tela: no apertar do botão
        // do mouse a biblioteca põe o foco na busca, e logo depois o navegador
        // o devolve ao botão (é o comportamento padrão de quem é clicado) — e o
        // que a pessoa digitava não ia a lugar nenhum. Impedir esse padrão não
        // impede o clique: a lista abre do mesmo jeito.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          className
        )}
      >
        <Combobox.Value>
          {(o: OpcaoDaLista | null) =>
            o && o.value !== "" ? (
              <span className="truncate">{o.label}</span>
            ) : (
              <span className="truncate text-muted-foreground">{o?.label ?? placeholder}</span>
            )
          }
        </Combobox.Value>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup
            className="w-(--anchor-width) min-w-64 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div className="flex items-center gap-2 border-b px-2.5">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                ref={buscaRef}
                placeholder="Digite para procurar…"
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
              {vazio}
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto p-1 empty:p-0">
              {(o: OpcaoDaLista) => (
                <Combobox.Item
                  key={o.value || "__vazio"}
                  value={o}
                  disabled={o.disabled}
                  className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className={cn("flex-1", o.value === "" && "text-muted-foreground")}>
                    {o.label}
                  </span>
                  <Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
