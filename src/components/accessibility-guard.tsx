"use client";

import { useEffect } from "react";

/**
 * Impede que a aplicação inteira fique invisível para leitor de tela.
 *
 * **O DEFEITO (achado em 26/08/2026, pelos testes ponta a ponta).** Enquanto um
 * aviso modal está aberto, a biblioteca de componentes (Base UI) marca todo o
 * resto da página com `aria-hidden="true"` — isso é correto e é assim que todo
 * modal funciona: quem usa leitor de tela deve ouvir só o aviso.
 *
 * O problema é o que sobra DEPOIS de fechar. A marca é **contada**: cada modal
 * aberto soma 1, e só o último a fechar apaga a marca. Mas quando a conta chega
 * a zero, a biblioteca joga fora a tabela inteira de contagens
 * (`markOthers.js`); se uma limpeza atrasada roda depois disso, a conta vira
 * **−1**, e o teste que apaga a marca é `if (!contador)` — que é falso para −1.
 * A marca fica para sempre. Com dois avisos empilhados (a recepção recebe
 * "agendar apresentação" e "iniciar tratamento" ao mesmo tempo), essa corrida
 * acontece.
 *
 * **Por que isso é grave e ao mesmo tempo invisível.** Os elementos continuam
 * desenhados: quem olha o monitor não vê nada de errado. O que sumiu foi a
 * *árvore de acessibilidade* — a versão da página que um leitor de tela usa
 * para saber o que existe. Para quem depende dele, **a tela fica vazia** até
 * recarregar. Foi assim que o robô dos testes também "perdeu" a página inteira,
 * com cara de "não carregou".
 *
 * **O que este guarda faz.** Vigia a página e, se não houver nenhuma janela
 * aberta, apaga qualquer marca de escondido que tenha sobrado por cima da
 * aplicação. Só age quando não há nada aberto — enquanto houver um modal, um
 * menu ou uma lista suspensa na tela, a marca é legítima e ele não encosta.
 *
 * É um CONTORNO de um defeito da biblioteca, não uma decisão de desenho:
 * quando o Base UI corrigir a contagem, este arquivo pode sair inteiro.
 */

/** O que, existindo na tela, torna a marca de escondido legítima. */
const JANELAS_ABERTAS =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"]';

export function AccessibilityGuard() {
  useEffect(() => {
    function conferir() {
      // Tem janela aberta? Então esconder o resto é o comportamento certo.
      if (document.querySelector(JANELAS_ABERTAS)) return;

      const main = document.querySelector("main");
      if (!main) return;

      // Sobe do conteúdo até o topo: a marca fica no invólucro que embrulha a
      // barra lateral e o conteúdo, não no <main> em si.
      for (let no: HTMLElement | null = main; no; no = no.parentElement) {
        if (no.getAttribute("aria-hidden") === "true") {
          no.removeAttribute("aria-hidden");
        }
        if (no.hasAttribute("inert")) no.removeAttribute("inert");
      }
    }

    // Reage à própria marca sendo escrita ou apagada, e a janelas que entram e
    // saem da página. Apagar a marca dispara o vigia de novo, e da segunda vez
    // não há nada para apagar — não gira em falso.
    const vigia = new MutationObserver(conferir);
    vigia.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert"],
    });
    conferir();

    return () => vigia.disconnect();
  }, []);

  return null;
}
