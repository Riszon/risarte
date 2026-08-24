import { describe, expect, it } from "vitest";
// Mesma razão da camada 1: as regras vivem em `scripts/` porque quem as usa é
// um script que roda fora do app, e o teste importa o MESMO módulo — copiar
// faria as duas versões divergirem e a varredura passaria a mentir.
import {
  PERMISSION_RULES,
  ROUTE_FIXTURES,
  classify,
  fillRoute,
  judge,
  routeFromFile,
  routeParams,
} from "../../../scripts/screen-rules.mjs";

describe("montagem da lista de rotas", () => {
  it("a pasta de GRUPO não entra na URL", () => {
    // `(app)` organiza o código e não aparece no navegador. Se entrasse, a
    // varredura pediria /(app)/financeiro/dre, levaria 404 em tudo e acusaria
    // o sistema inteiro de quebrado.
    expect(routeFromFile("(app)/financeiro/dre/page.tsx")).toBe(
      "/financeiro/dre"
    );
  });

  it("a página do grupo é a raiz", () => {
    expect(routeFromFile("(app)/page.tsx")).toBe("/");
  });

  it("rota fora do grupo continua inteira", () => {
    expect(routeFromFile("documentos/[id]/imprimir/page.tsx")).toBe(
      "/documentos/[id]/imprimir"
    );
  });

  it("aceita o separador do Windows", () => {
    expect(routeFromFile("(app)\\compras\\painel\\page.tsx")).toBe(
      "/compras/painel"
    );
  });

  it("acha e preenche o trecho variável", () => {
    expect(routeParams("/comercial/[clientId]")).toEqual(["clientId"]);
    expect(routeParams("/compras/painel")).toEqual([]);
    expect(fillRoute("/comercial/[clientId]", "abc-123")).toBe(
      "/comercial/abc-123"
    );
  });

  it("o registro é escolhido pela ROTA, não pelo nome do trecho", () => {
    // Três rotas têm `[id]` e cada uma espera um registro diferente. Casar
    // pelo nome abriria o prontuário com o id de uma adesão do PPR+ — 404 com
    // cara de bug.
    expect(ROUTE_FIXTURES["/prontuarios/[id]"]).toBe("client");
    expect(ROUTE_FIXTURES["/ppr/adesoes/[id]"]).toBe("pprMembership");
    expect(ROUTE_FIXTURES["/documentos/[id]/imprimir"]).toBe(
      "clinicalDocument"
    );
  });
});

describe("o que a resposta significa", () => {
  it("200 limpo abriu", () => {
    expect(classify({ status: 200, body: "<html>Fluxo de caixa</html>" }))
      .toMatchObject({ verdict: "ok" });
  });

  it("ACUSA a tela que responde 200 e renderiza erro", () => {
    // O React engole a exceção no limite de erro e devolve a página "com
    // sucesso". Olhar só o número da resposta deixaria isto passar.
    expect(
      classify({
        status: 200,
        body: "<html>Application error: a server-side exception</html>",
      })
    ).toMatchObject({ verdict: "erro" });
  });

  it("404 é bloqueio, não rota faltando", () => {
    expect(classify({ status: 404 })).toMatchObject({ verdict: "bloqueado" });
  });

  it("redirect para a raiz é bloqueio (o requireAdminMaster)", () => {
    expect(classify({ status: 307, location: "/" })).toMatchObject({
      verdict: "bloqueado",
    });
  });

  it("redirect para o login é sessão perdida", () => {
    expect(
      classify({ status: 307, location: "http://localhost:3000/login" })
    ).toMatchObject({ verdict: "login" });
  });

  it("outro redirect é só anotado", () => {
    expect(classify({ status: 307, location: "/jornada" })).toMatchObject({
      verdict: "redirecionou",
    });
  });

  it("500 é quebra", () => {
    expect(classify({ status: 500 })).toMatchObject({ verdict: "erro" });
  });
});

describe("falha, acerto ou observação", () => {
  const master = { role: null, isAdminMaster: true };

  it("ACUSA o 404 em rota que existe — o caso de /financeiro/configuracao", () => {
    // Foi o defeito que custou um diagnóstico inteiro: a página existia e o
    // sistema respondia 404. Para o Admin Master não há permissão que explique.
    expect(
      judge({ verdict: "bloqueado", route: "/financeiro/configuracao", ...master })
    ).toMatchObject({ level: "falha" });
  });

  it("cair no login derruba o resultado, para qualquer papel", () => {
    // Sem sessão a varredura testaria o proxy, não as telas — e todas as
    // páginas "passariam" por estarem protegidas.
    expect(
      judge({ verdict: "login", route: "/agenda", role: "dentist", isAdminMaster: false })
    ).toMatchObject({ level: "falha" });
  });

  it("tela quebrada é falha e carrega o motivo", () => {
    expect(
      judge({
        verdict: "erro",
        detail: "abriu, mas a tela renderizou erro",
        route: "/estoque",
        ...master,
      })
    ).toMatchObject({ level: "falha", note: "abriu, mas a tela renderizou erro" });
  });

  it("ACUSA a recepção enxergando contas a pagar", () => {
    expect(
      judge({
        verdict: "ok",
        route: "/financeiro/contas-a-pagar",
        role: "receptionist",
        isAdminMaster: false,
      })
    ).toMatchObject({ level: "falha" });
  });

  it("recepção barrada em contas a pagar é o esperado", () => {
    expect(
      judge({
        verdict: "bloqueado",
        route: "/financeiro/contas-a-pagar",
        role: "receptionist",
        isAdminMaster: false,
      })
    ).toMatchObject({ level: "ok" });
  });

  it("ACUSA o comprador barrado na própria mesa de negociação", () => {
    // A regra vale nos dois sentidos: bloquear quem devia entrar é tão defeito
    // quanto liberar quem não devia.
    expect(
      judge({
        verdict: "bloqueado",
        route: "/compras/rodadas",
        role: "purchaser",
        isAdminMaster: false,
      })
    ).toMatchObject({ level: "falha" });
  });

  it("o gerente barrado no consolidado da rede é o esperado", () => {
    expect(
      judge({
        verdict: "bloqueado",
        route: "/financeiro/consolidado",
        role: "unit_manager",
        isAdminMaster: false,
      })
    ).toMatchObject({ level: "ok" });
  });

  it("ser MANDADO EMBORA conta como barrado — o falso positivo da 1ª versão", () => {
    // As guardas recusam de três jeitos, e o terceiro é mandar para outra
    // tela: `/financeiro/consolidado` joga o gerente na DRE da própria
    // unidade. A primeira régua só conhecia 404 e volta-à-raiz, e acusou três
    // telas CORRETAMENTE protegidas de "abriram para quem não devia" — régua
    // que erra manda consertar o que está certo.
    for (const route of [
      "/financeiro/consolidado",
      "/financeiro/painel-da-rede",
      "/compras/rodadas",
    ]) {
      expect(
        judge({
          verdict: "redirecionou",
          detail: "foi para /financeiro/dre",
          route,
          role: "unit_manager",
          isAdminMaster: false,
        })
      ).toMatchObject({ level: "ok" });
    }
  });

  it("mas o redirecionamento NÃO acusa o Admin Master", () => {
    // Página que leva a outra é caminho normal; julgá-lo aqui repetiria o
    // mesmo erro do outro lado.
    expect(
      judge({
        verdict: "redirecionou",
        detail: "foi para /ppr/painel",
        route: "/ppr",
        ...master,
      })
    ).toMatchObject({ level: "observado" });
  });

  it("bloqueio SEM regra escrita é observação, não veredito", () => {
    // Inventar matriz de permissão aqui seria transformar palpite em teste, e
    // ele passaria a "provar" o que eu chutei.
    expect(
      judge({
        verdict: "bloqueado",
        route: "/relatorios",
        role: "dentist",
        isAdminMaster: false,
      })
    ).toMatchObject({ level: "observado" });
  });

  it("a regra do login vale para todo papel", () => {
    const regra = PERMISSION_RULES.find(
      (r: { route: string }) => r.route === "/login"
    );
    expect(regra.role).toBe("*");
    for (const role of [null, "dentist", "purchaser"]) {
      expect(
        judge({ verdict: "bloqueado", route: "/login", role, isAdminMaster: role === null })
      ).toMatchObject({ level: "ok" });
    }
  });
});
