import { describe, expect, it, vi } from "vitest";

// `server-only` derruba qualquer import fora do servidor do Next — inclusive o
// do teste. Aqui ele não protege nada.
vi.mock("server-only", () => ({}));

const { carregarRelatos } = await import("@/app/(app)/problemas/dados");

/**
 * Um cliente falso que responde a cada `select` com o que a fila mandar. Só
 * as partes da corrente que `carregarRelatos` usa.
 */
function clienteFalso(respostas: { data?: unknown; error?: { code: string; message: string } }[]) {
  const pedidos: string[] = [];
  const client = {
    from() {
      return {
        select(colunas: string) {
          pedidos.push(colunas);
          const resposta = respostas.shift() ?? { data: [] };
          const corrente = {
            eq: () => corrente,
            order: () => corrente,
            limit: () => Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }),
          };
          return corrente;
        },
      };
    },
  };
  return { client: client as never, pedidos };
}

const LINHA_0247 = {
  id: "r1",
  code: "OC-00009",
  kind: "erro",
  severity: "media",
  title: "t",
  what_happened: "w",
  expected: null,
  screen: "/agenda",
  app_version: "0.246.0",
  error_digest: null,
  user_agent: null,
  status: "resolvido",
  answer: "Resposta antiga",
  answered_at: "2026-09-10T12:00:00.000Z",
  resolved_version: null,
  created_at: "2026-09-09T12:00:00.000Z",
  reporter_role: "Recepcionista",
  reporter_id: "eu",
  clinic_id: "c1",
  profiles: { full_name: "Maria" },
  clinics: { name: "Cambé" },
};

describe("carregar relatos — a janela antes de a 0256 rodar", () => {
  it("banco sem a 0256: cai para as colunas antigas e a lista APARECE", async () => {
    const { client, pedidos } = clienteFalso([
      { error: { code: "42703", message: "column system_reports.module does not exist" } },
      { data: [LINHA_0247] },
    ]);
    const { relatos, nivel } = await carregarRelatos(client, "eu");

    expect(nivel).toBe("sem_0256");
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).not.toContain("module");
    expect(relatos).toHaveLength(1);
    const r = relatos[0];
    // A resposta única da 0247 conta como uma resposta…
    expect(r.respostas).toBe(1);
    // …mas não acende "Resposta nova": sem a coluna de leitura não há como
    // saber, e acender tudo o que já foi respondido seria alarme falso.
    expect(r.respostaLida).toBe(true);
    expect(r.module).toBeNull();
    expect(r.firstResponseAt).toBe("2026-09-10T12:00:00.000Z");
    expect(r.meu).toBe(true);
  });

  it("o embed da conversa desconhecido também é migração pendente", async () => {
    const { client } = clienteFalso([
      { error: { code: "PGRST200", message: "Could not find a relationship" } },
      { data: [LINHA_0247] },
    ]);
    expect((await carregarRelatos(client, "eu")).nivel).toBe("sem_0256");
  });

  it("banco sem a tabela (0247): lista vazia declarada, não erro", async () => {
    const { client } = clienteFalso([
      { error: { code: "42P01", message: "relation does not exist" } },
    ]);
    expect(await carregarRelatos(client, "eu")).toEqual({ relatos: [], nivel: "sem_tabela" });
  });

  it("⚠️ outro erro NÃO vira lista vazia — sobe, para a tela de erro mostrar", async () => {
    // Engolir aqui faria a fila aparecer vazia com o banco fora do ar: o
    // Admin Master concluiria que não há relatos.
    const { client } = clienteFalso([
      { error: { code: "57014", message: "canceling statement due to statement timeout" } },
    ]);
    await expect(carregarRelatos(client, "eu")).rejects.toThrow("timeout");
  });

  it("banco completo: conta respostas e sabe quem falou por último", async () => {
    const { client } = clienteFalso([
      {
        data: [
          {
            ...LINHA_0247,
            status: "em_analise",
            module: "agenda",
            reopened_count: 1,
            reporter_seen_answer_at: null,
            // Fora de ordem de propósito: quem decide a ordem é o `seq`.
            system_report_messages: [
              { seq: 4, kind: "reabertura" },
              { seq: 1, kind: "resposta" },
              { seq: 2, kind: "situacao" },
              { seq: 3, kind: "resposta" },
              { seq: 5, kind: "situacao" },
            ],
          },
        ],
      },
    ]);
    const { relatos, nivel } = await carregarRelatos(client, "outra-pessoa");
    const r = relatos[0];
    expect(nivel).toBe("completo");
    expect(r.respostas).toBe(2);
    // A linha de situação depois da reabertura não conta como "fala".
    expect(r.ultimaFalaDoRelator).toBe(true);
    expect(r.respostaLida).toBe(false);
    expect(r.module).toBe("agenda");
    expect(r.meu).toBe(false);
  });

  it("módulo que o banco devolver fora da lista vira nulo, não texto cru na tela", async () => {
    const { client } = clienteFalso([
      { data: [{ ...LINHA_0247, module: "inventado", system_report_messages: [] }] },
    ]);
    expect((await carregarRelatos(client, "eu")).relatos[0].module).toBeNull();
  });
});
