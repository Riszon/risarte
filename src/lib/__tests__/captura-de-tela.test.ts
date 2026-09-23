import { describe, expect, it, vi, afterEach } from "vitest";
import { SEGUNDOS_DA_CONTAGEM, capturarTela } from "@/lib/captura-de-tela";

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

function encenarNavegador(chamadas: Chamada[], superficie = "monitor") {
  const pedidos: Record<string, unknown>[] = [];
  const faixa = {
    stop: () => chamadas.push("parou a faixa"),
    getSettings: () => ({ displaySurface: superficie }),
  };
  const g = globalThis as unknown as Record<string, unknown>;

  // `navigator` no Node só tem leitura — daí definir a propriedade em vez de
  // atribuir.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async (pedido: Record<string, unknown>) => {
          pedidos.push(pedido);
          chamadas.push("pediu permissão");
          return { getTracks: () => [faixa], getVideoTracks: () => [faixa] };
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
  return pedidos;
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
      contagem: SEGUNDOS_DA_CONTAGEM,
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
    expect(contados).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    // E o painel só sai da frente DEPOIS dela — nunca antes.
    expect(chamadas.indexOf("escondeu o painel")).toBeGreaterThan(
      chamadas.indexOf("faltam 1")
    );
    expect(chamadas.indexOf("tirou a foto")).toBeGreaterThan(
      chamadas.indexOf("escondeu o painel")
    );
  });

  it("com tempo, pede a TELA INTEIRA — é onde a lista aberta existe", async () => {
    const chamadas: Chamada[] = [];
    const pedidos = encenarNavegador(chamadas);
    vi.useFakeTimers();

    const promessa = capturarTela({
      nome: "tela.png",
      origem: "tela-inteira",
      contagem: 1,
    });
    await vi.runAllTimersAsync();
    const r = await promessa;

    expect(r.ok).toBe(true);
    // O pedido ao navegador tem de dizer "monitor": fotografar a ABA nunca
    // mostraria a lista, por mais tempo que se espere.
    const video = pedidos[0]?.video as { displaySurface?: string } | undefined;
    expect(video?.displaySurface).toBe("monitor");
    expect(pedidos[0]?.preferCurrentTab).toBe(false);
  });

  it("devolve o que a pessoa escolheu de fato, para a tela poder avisar", async () => {
    const chamadas: Chamada[] = [];
    // Ela pediu a tela inteira, mas escolheu uma ABA na janela do navegador.
    encenarNavegador(chamadas, "browser");
    vi.useFakeTimers();

    const promessa = capturarTela({ nome: "tela.png", origem: "tela-inteira", contagem: 1 });
    await vi.runAllTimersAsync();
    const r = await promessa;

    expect(r.ok).toBe(true);
    // Sem isto, o print sairia sem a lista e ninguém saberia por quê.
    expect(r.ok && r.superficie).toBe("browser");
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
