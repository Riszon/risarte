import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABAS_DOS_AVISOS, abaDoAviso, linkDoAviso } from "@/lib/notifications";

// OC-00093 (05/10/2026): o "Abrir" do aviso "Pedido respondido" não abria o
// prontuário — e, quando abria, caía na aba Cadastro em vez de Pedidos.

const ID = "3ab3cab2-48cb-4637-a364-5852fd6c25d9";

describe("o aviso abre o prontuário na aba do assunto", () => {
  it("pedido respondido → Pedidos, saindo do endereço antigo /clientes", () => {
    expect(linkDoAviso(`/clientes/${ID}`, "Pedido respondido: Fulano")).toBe(
      `/prontuarios/${ID}?aba=pedidos`
    );
  });

  it("um título de cada aba, como o banco escreve", () => {
    expect(abaDoAviso("Sugestão de reavaliação: Fulano")).toBe("pedidos");
    expect(abaDoAviso("Revisão do plano pendente: Fulano")).toBe("pedidos");
    expect(abaDoAviso("Plano aprovado")).toBe("plano");
    expect(abaDoAviso("Plano de tratamento para aprovação")).toBe("plano");
    expect(abaDoAviso("Plano parado: Fulano")).toBe("sessoes");
    expect(abaDoAviso("Procedimento reprovado — refazer")).toBe("sessoes");
    expect(abaDoAviso("Venda direta aguardando fechamento")).toBe("sessoes");
    expect(abaDoAviso("Renegociação com desconto — autorizar?")).toBe("financeiro");
    expect(abaDoAviso("Renegociação recusada")).toBe("financeiro");
    expect(abaDoAviso("Agendar apresentação: Fulano")).toBe("jornada");
    expect(abaDoAviso("Fechamento! Agendar início de tratamento")).toBe("jornada");
    expect(abaDoAviso("Cancelamento — agendar REAVALIAÇÃO")).toBe("jornada");
    expect(abaDoAviso("Cliente transferido para a sua unidade")).toBe("historico");
    expect(abaDoAviso("Compartilhamento encerrado")).toBe("historico");
  });

  it("decisão fica fora do mapa: a caixa dela está no topo, acima das abas", () => {
    expect(abaDoAviso("Decisão obrigatória: necessita reavaliação?")).toBeNull();
    expect(linkDoAviso(`/clientes/${ID}`, "Decisão urgente: necessita reavaliação?")).toBe(
      `/prontuarios/${ID}`
    );
  });

  it("endereço que não é de cliente passa intacto", () => {
    expect(linkDoAviso("/agenda?cliente=" + ID, "Pedido respondido: X")).toBe(
      "/agenda?cliente=" + ID
    );
    expect(linkDoAviso("/planejamento/" + ID, "Plano aprovado")).toBe("/planejamento/" + ID);
    expect(linkDoAviso(`/prontuarios/${ID}?aba=plano`, "Pedido respondido: X")).toBe(
      `/prontuarios/${ID}?aba=plano`
    );
  });
});

describe("régua: toda aba do mapa existe no prontuário", () => {
  // Se alguém renomear uma aba, o aviso cairia em silêncio na primeira — a
  // mesma queixa do relato. Esta régua reprova antes.
  const pagina = readFileSync(
    join(process.cwd(), "src/app/(app)/prontuarios/[id]/page.tsx"),
    "utf8"
  );
  const abasDaTela = [...pagina.matchAll(/<TabPanel\s+id="([a-z]+)"/g)].map((m) => m[1]);

  it("achou as abas da tela (zero = régua cega, não 'tudo certo')", () => {
    expect(abasDaTela.length).toBeGreaterThan(5);
  });

  it.each(ABAS_DOS_AVISOS)("aba %s", (aba) => {
    expect(abasDaTela).toContain(aba);
  });
});

describe("o Abrir do aviso não lido não pode ser cancelado pela própria tela", () => {
  // CRLF → LF: com `core.autocrlf` o Git regrava o arquivo com \r\n, e o
  // recorte abaixo passaria do fim da função (lendo o refresh de OUTRA).
  const lista = readFileSync(
    join(process.cwd(), "src/app/(app)/notificacoes/notification-list.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const abrir = lista.slice(lista.indexOf("function abrirNaoLido"));
  const fim = abrir.indexOf("\n  }\n");
  const corpo = abrir.slice(0, fim);

  it("achou a função inteira (recorte que não acha o fim é régua cega)", () => {
    expect(lista.indexOf("function abrirNaoLido")).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(0);
  });

  it("marca, espera e só então navega — sem refresh no meio", () => {
    expect(corpo).toMatch(/await markNotificationRead/);
    expect(corpo).toMatch(/router\.push\(href\)/);
    expect(corpo).not.toMatch(/router\.refresh/);
  });
});
