import { describe, expect, it, vi, afterEach } from "vitest";
import { capturarTela } from "@/lib/captura-de-tela";

/**
 * A ESPERA ANTES DA FOTO (pedido do dono, 23/09/2026 — caixa de seleção
 * aberta no print).
 *
 * O que este teste prende é a ORDEM, que é a razão de a correção existir: a
 * contagem tem de acontecer com a tela ainda visível, e o painel só sai da
 * frente DEPOIS dela. Invertido, a pessoa ficaria sem saber quanto falta —
 * e a foto sairia enquanto ela ainda estivesse procurando a caixa.
 *
 * O navegador é encenado aqui de propósito: `getDisplayMedia` não existe fora
 * dele, e o que se quer medir é a nossa sequência, não a dele.
 */

type Chamada = string;

function encenarNavegador(chamadas: Chamada[]) {
  const faixa = { stop: () => chamadas.push("parou a faixa") };
  const g = globalThis as unknown as Record<string, unknown>;

  // `navigator` no Node só tem leitura — daí definir a propriedade em vez de
  // atribuir.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => {
          chamadas.push("pediu permissão");
          return { getTracks: () => [faixa] };
        },
      },
    },
  });
  g.requestAnimationFrame = (f: () => void) => {
    setTimeout(f, 0);
    return 0;
  };
  g.document = {
    createElement: (tag: string) => {
      if (tag === "video") {
        return {
          muted: false,
          playsInline: false,
          srcObject: null,
          play: async () => {},
          videoWidth: 800,
          videoHeight: 600,
        };
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => chamadas.push("tirou a foto") }),
        toBlob: (r: (b: Blob) => void) => r(new Blob(["x"], { type: "image/png" })),
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("capturarTela — a espera antes do obturador", () => {
  it("conta para trás e só esconde o painel quando a contagem acaba", async () => {
    const chamadas: Chamada[] = [];
    const contados: number[] = [];
    encenarNavegador(chamadas);
    vi.useFakeTimers();

    const promessa = capturarTela({
      nome: "tela.png",
      contagem: 5,
      aoContar: (n) => {
        contados.push(n);
        chamadas.push(`faltam ${n}`);
      },
      esconder: () => chamadas.push("escondeu o painel"),
      mostrar: () => chamadas.push("mostrou o painel"),
    });
    await vi.runAllTimersAsync();
    const r = await promessa;

    expect(r.ok).toBe(true);
    // A contagem sai inteira, terminando em zero.
    expect(contados).toEqual([5, 4, 3, 2, 1, 0]);
    // E o painel só sai da frente DEPOIS dela — nunca antes.
    expect(chamadas.indexOf("escondeu o painel")).toBeGreaterThan(
      chamadas.indexOf("faltam 1")
    );
    expect(chamadas.indexOf("tirou a foto")).toBeGreaterThan(
      chamadas.indexOf("escondeu o painel")
    );
  });

  it("sem espera pedida, não conta nada e fotografa direto", async () => {
    const chamadas: Chamada[] = [];
    const contados: number[] = [];
    encenarNavegador(chamadas);
    vi.useFakeTimers();

    const promessa = capturarTela({
      nome: "tela.png",
      aoContar: (n) => contados.push(n),
      esconder: () => chamadas.push("escondeu o painel"),
    });
    await vi.runAllTimersAsync();
    const r = await promessa;

    expect(r.ok).toBe(true);
    // Só o zero final, que é o que devolve a tela ao texto normal do botão.
    expect(contados).toEqual([0]);
  });
});
