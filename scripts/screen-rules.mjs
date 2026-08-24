// AS REGRAS DA VARREDURA DE TELAS — funções puras, sem rede e sem banco.
//
// Mesma separação da camada 1: aqui mora o que DECIDE (qual rota existe, o que
// a resposta significa, se aquilo é falha ou só observação) e no
// `check-screens.mjs` mora o que FAZ (abrir a página, imprimir). Só assim dá
// para prender a decisão em teste — conferência que ninguém provou que dispara
// passa por cegueira, não por saúde.

/**
 * Caminho do arquivo (relativo a `src/app`) → rota do navegador.
 *
 * Grupos de rota — as pastas entre parênteses, como `(app)` — organizam o
 * código e NÃO aparecem na URL. Tratá-las como pasta normal geraria
 * `/(app)/agenda`, que dá 404 em tudo e faria a varredura acusar o sistema
 * inteiro de quebrado.
 */
export function routeFromFile(relPath) {
  const parts = relPath
    .replace(/\\/g, "/")
    .replace(/(^|\/)page\.tsx$/, "")
    .split("/")
    .filter((p) => p && !(p.startsWith("(") && p.endsWith(")")));
  return "/" + parts.join("/");
}

/** Nomes dos trechos variáveis da rota: `/comercial/[clientId]` → clientId. */
export function routeParams(route) {
  return [...route.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
}

/** Troca o trecho variável por um registro real. */
export function fillRoute(route, id) {
  return route.replace(/\[[^\]]+\]/g, id);
}

/**
 * Que tipo de registro cada rota variável espera.
 *
 * O mapa é por ROTA, não pelo nome do trecho: `[id]` é prontuário em um lugar,
 * adesão do PPR+ em outro e documento clínico em um terceiro. Casar pelo nome
 * abriria a tela do prontuário com o id de uma adesão — 404 com cara de bug.
 */
export const ROUTE_FIXTURES = {
  "/admin/usuarios/[id]": "user",
  "/apresentacao/[clientId]": "client",
  "/avaliacao/[clientId]": "client",
  "/comercial/[clientId]": "client",
  "/planejamento/[clientId]": "client",
  "/prontuarios/[id]": "client",
  "/empresarial/[companyId]": "company",
  "/empresarial/[companyId]/ficha": "company",
  "/empresarial/[companyId]/relatorio": "company",
  "/empresarial/[companyId]/relatorio-beneficios": "company",
  "/ppr/adesoes/[id]": "pprMembership",
  "/ppr/adesoes/[id]/contrato": "pprMembership",
  "/ppr/configuracao/[planId]": "pprPlan",
  "/ppr/cartao/[beneficiaryId]": "pprBeneficiary",
  "/cancelamentos/[id]/termo": "cancellation",
  "/documentos/[id]/imprimir": "clinicalDocument",
  "/renegociacoes/[id]/acordo": "renegotiation",
};

/**
 * Texto que denuncia erro numa resposta que veio com status 200.
 *
 * O React consegue engolir a exceção num limite de erro e devolver a página
 * "com sucesso"; olhar só o número da resposta deixaria isso passar. São
 * marcas do próprio Next, em inglês — a interface é toda em pt-BR, então não
 * há como uma tela de verdade conter esse texto por acaso.
 */
export const ERROR_MARKERS = [
  "Application error: a client-side exception",
  "Application error: a server-side exception",
  "Unhandled Runtime Error",
  "__NEXT_ERROR_CODE",
  "Internal Server Error",
];

/**
 * O que a resposta significa.
 *
 * **404 aqui quase nunca é rota faltando.** As telas deste sistema usam
 * `notFound()` como resposta de "você não pode ver isto", e `redirect("/")`
 * como a outra forma da mesma coisa. Quem separa um caso do outro é o papel de
 * quem pediu: para o Admin Master, que enxerga tudo, 404 só pode ser defeito.
 */
export function classify({ status, location = null, body = "" }) {
  if (status >= 300 && status < 400) {
    const to = String(location ?? "").replace(/^https?:\/\/[^/]+/, "");
    if (to.startsWith("/login")) return { verdict: "login", detail: "" };
    if (to === "" || to === "/") return { verdict: "bloqueado", detail: "" };
    return { verdict: "redirecionou", detail: `foi para ${to}` };
  }
  if (status === 404) return { verdict: "bloqueado", detail: "" };
  if (status >= 500) return { verdict: "erro", detail: `resposta ${status}` };
  if (status !== 200) return { verdict: "erro", detail: `resposta ${status}` };

  const marker = ERROR_MARKERS.find((m) => body.includes(m));
  if (marker) {
    return { verdict: "erro", detail: "abriu, mas a tela renderizou erro" };
  }
  return { verdict: "ok", detail: "" };
}

/**
 * As regras de acesso que estão ESCRITAS no CLAUDE.md — decisões do dono, não
 * palpite meu. O que não está aqui a varredura relata como observação, sem
 * julgar: inventar uma matriz de permissão seria transformar suposição em
 * teste, e ela passaria a "provar" o que eu chutei.
 *
 * `role: "*"` vale para todo mundo.
 */
export const PERMISSION_RULES = [
  {
    role: "*",
    route: "/login",
    expect: "bloqueado",
    why: "quem está logado não volta ao login — é a prova de que a sessão da varredura vale",
  },
  {
    role: "receptionist",
    route: "/financeiro/contas-a-pagar",
    expect: "bloqueado",
    why: "pagar fornecedor não é ato de balcão (FIN3)",
  },
  {
    role: "receptionist",
    route: "/compras",
    expect: "bloqueado",
    why: "mesma lógica de contas a pagar (módulo Compras)",
  },
  {
    role: "dentist",
    route: "/financeiro/dre",
    expect: "bloqueado",
    why: "dentista não vê financeiro",
  },
  {
    role: "dentist",
    route: "/estoque",
    expect: "ok",
    why: "o Estoque mora fora do Financeiro justamente para o dentista alcançar",
  },
  {
    role: "unit_manager",
    route: "/financeiro/consolidado",
    expect: "bloqueado",
    why: "consolidado é só da Franqueadora (FIN8.2)",
  },
  {
    role: "unit_manager",
    route: "/financeiro/painel-da-rede",
    expect: "bloqueado",
    why: "painel da rede é só da Franqueadora (FIN8.3)",
  },
  {
    role: "unit_manager",
    route: "/compras/rodadas",
    expect: "bloqueado",
    why: "mostrar a cotação ao franqueado entrega a negociação da rede (C2)",
  },
  {
    role: "unit_manager",
    route: "/financeiro/dre",
    expect: "ok",
    why: "o gerente vê o financeiro da PRÓPRIA unidade",
  },
  {
    role: "purchaser",
    route: "/compras/rodadas",
    expect: "ok",
    why: "a mesa de negociação é o trabalho do comprador (C2)",
  },
  {
    role: "finance_franchisor",
    route: "/financeiro/dre",
    expect: "ok",
    why: "é o financeiro da rede",
  },
];

/**
 * Ser mandado embora É ser barrado.
 *
 * As guardas deste sistema recusam de três jeitos: `notFound()` (404),
 * `redirect("/")` e **`redirect` para outra tela** — o gerente que pede o
 * consolidado da rede cai na DRE da própria unidade. A primeira versão desta
 * régua só conhecia os dois primeiros, e acusou três telas que estão
 * corretamente protegidas de "abriram para quem não devia". Régua que erra é
 * pior que régua que não existe: ela manda consertar o que está certo.
 */
export function isBlocked(verdict) {
  return verdict === "bloqueado" || verdict === "redirecionou";
}

/**
 * Falha, acerto ou observação.
 *
 * Três coisas são falha para qualquer papel: cair no login (a sessão da
 * varredura morreu e o resultado inteiro passa a não valer), a tela quebrar, e
 * o Admin Master ser barrado. O resto só vira falha quando contraria uma regra
 * escrita.
 */
export function judge({ verdict, detail = "", role, isAdminMaster, route }) {
  if (verdict === "login") {
    return {
      level: "falha",
      note: "caiu no login — a sessão da varredura não valeu nesta tela",
    };
  }
  if (verdict === "erro") {
    return { level: "falha", note: detail || "a tela quebrou" };
  }

  const rule = PERMISSION_RULES.find(
    (r) => r.route === route && (r.role === "*" || r.role === role)
  );
  if (rule) {
    const passou =
      rule.expect === "ok" ? verdict === "ok" : isBlocked(verdict);
    if (passou) return { level: "ok", note: "" };
    return {
      level: "falha",
      note:
        rule.expect === "bloqueado"
          ? `devia estar bloqueada (${rule.why}) e abriu`
          : `devia abrir (${rule.why}) e ${detail || "ficou bloqueada"}`,
    };
  }

  // Só o 404 e a volta à raiz acusam o Admin Master. Redirecionamento para
  // outra tela é caminho normal de página (o /ppr que leva ao painel) e vira
  // observação — julgá-lo aqui repetiria o erro da régua de bloqueio.
  if (isAdminMaster && verdict === "bloqueado") {
    return {
      level: "falha",
      note: "404 para o Admin Master é rota quebrada, não permissão",
    };
  }

  if (verdict === "ok") return { level: "ok", note: "" };
  return { level: "observado", note: detail || verdict };
}
