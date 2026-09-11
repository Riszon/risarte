"use client";

import type { CSSProperties } from "react";
import { useAmbiente, type Ambiente } from "@/components/ambiente";
import { cn } from "@/lib/utils";

// O SÍMBOLO continua sendo usado como MÁSCARA: o desenho recorta e a cor vem do
// `text-*` de quem o usa. É o que permite ele aparecer em off-white sobre a
// lateral, em turquesa num cabeçalho e a 10% de opacidade como marca d'água,
// tudo com um arquivo só. O sorriso é vazado, então assume a cor do fundo —
// exatamente como a arte da agência faz.
function maskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

/** Símbolo da Risarte (o losango). Defina a altura e a cor via `text-*`. */
export function RisarteMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Risarte"
      className={cn("inline-block aspect-[115/125] bg-current", className)}
      style={maskStyle("/marca/simbolo-claro.svg")}
    />
  );
}

/**
 * ⚠️ QUAL VARIANTE DA ASSINATURA VAI SOBRE A BARRA LATERAL — e por quê.
 *
 * A agência entrega, para cada frente, uma versão "para fundo escuro": o nome
 * RISARTE em off-white e o complemento (ODONTOLOGIA / FRANCHISING /
 * EMPRESARIAL) na cor de detalhe. Isso funciona enquanto a lateral não for da
 * cor do complemento.
 *
 * **No Empresarial passou a ser.** Quando o dono pediu a lateral em bordô, o
 * complemento bordô ficou bordô sobre bordô e a palavra EMPRESARIAL sumiu — ele
 * viu na amostra: *"a palavra empresarial não aparece por ser a mesma cor da
 * barra lateral"*. Ali entra a versão **monocromática**, toda em off-white.
 *
 * A Franqueadora é o caso oposto e por isso é exceção declarada: a lateral dela
 * é turquesa, e off-white sobre turquesa dá 2,4:1. A versão toda branca deixaria
 * a assinatura INTEIRA ilegível; a normal mantém o complemento em marinho, que
 * dá 4,6:1. Aqui a regra "toda branca no escuro" cede para o contraste.
 */
const ASSINATURA: Record<Ambiente, { claro: string; escuro: string; nome: string }> = {
  unidades: {
    claro: "/marca/odontologia-lockup-claro.svg",
    escuro: "/marca/odontologia-lockup-branco.svg",
    nome: "Risarte Odontologia",
  },
  franchising: {
    // Exceção: lateral turquesa nas duas luzes — ver o comentário acima.
    claro: "/marca/franchising-lockup.svg",
    escuro: "/marca/franchising-lockup.svg",
    nome: "Risarte Franchising",
  },
  empresarial: {
    // Lateral bordô nas duas luzes: sempre a monocromática.
    claro: "/marca/empresarial-lockup.svg",
    escuro: "/marca/empresarial-lockup.svg",
    nome: "Risarte Empresarial",
  },
};

/**
 * ⚠️ POR QUE `-lockup` E NÃO O ARQUIVO OFICIAL (10/09/2026).
 *
 * O manual da marca constrói as três assinaturas com proporções DIFERENTES: em
 * Franchising e Empresarial a palavra "Risarte" tem 0,386 da altura do símbolo;
 * em Odontologia, 0,565. As duas primeiras concordam entre si até a terceira
 * casa decimal — é a de Odontologia que é diferente. Não é erro de conversão:
 * `npm run marca:conferir` mede 0,00% de diferença de forma contra a arte
 * original nas doze.
 *
 * Na tela isso aparece do pior jeito: a barra lateral fica parada e só a marca
 * troca ao mudar de ambiente, então o pulo de tamanho salta aos olhos. O dono
 * viu e disse o que precisa acontecer: *"o símbolo e a palavra Risarte devem
 * casar"*.
 *
 * Os `-lockup` são DERIVADOS gerados por `npm run marca:lockup`: mesmo desenho,
 * com o bloco de texto reposicionado para a proporção de Odontologia — a que
 * ele aprovou. **Os doze arquivos oficiais continuam intocados e continuam
 * sendo conferidos contra a arte original**; mexer neles quebraria a régua que
 * garante que a marca do sistema é a marca de verdade, e essa régua vale mais
 * que a conveniência de uma tela. Para abandonar o ajuste, basta voltar a
 * apontar para os `-horizontal-`.
 */

/**
 * A assinatura completa do ambiente, para a barra lateral.
 *
 * As duas luzes são DESENHADAS e alternadas por CSS, em vez de trocadas por
 * JavaScript: assim a versão certa já vem no primeiro quadro, sem piscar a
 * errada enquanto o navegador decide. São arquivos de ~9 KB.
 */
export function AssinaturaDoAmbiente({ className }: { className?: string }) {
  const ambiente = useAmbiente();
  const { claro, escuro, nome } = ASSINATURA[ambiente];

  if (claro === escuro) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={claro} alt={nome} className={className} />;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={claro} alt={nome} className={cn(className, "dark:hidden")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={escuro} alt="" aria-hidden className={cn(className, "hidden dark:block")} />
    </>
  );
}
