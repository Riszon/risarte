import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ⚠️ 2ª LIGAÇÃO PARA A MESMA TABELA = EMBED AMBÍGUO (PGRST201).
//
// A 0281 deu à matrícula (`training_enrollments`) uma segunda ligação para
// `profiles` (`approved_by`, além de `user_id`). A partir daí, todo
// `profiles(...)` embutido a partir da matrícula passou a falhar — e a fila de
// aprovação e a lista de turmas do Admin não carregaram, NA PRODUÇÃO. Achado
// no teste ponta a ponta do portão (26/09/2026), não por relato.
//
// A lição já estava no ARQUITETURA-TECNICA ("2ª FK para a mesma tabela"),
// escrita para `clients → clinics`. Lição que depende de alguém lembrar
// repete; esta régua prende as tabelas que já têm DUAS ligações para o mesmo
// lugar: o embed tem de dizer qual (`profiles!<nome_da_fk>(...)`).
const AMBIGUOS: { origem: string; destino: string }[] = [
  { origem: "training_enrollments", destino: "profiles" },
  // Indica +Risos (2000): origem, conversão e criado_por apontam para profiles.
  { origem: "indicacoes", destino: "profiles" },
  { origem: "v_indicacoes", destino: "profiles" },
  // Indica +Risos (2007): apuração ganhou criado_por, além de aprovado_por.
  { origem: "apuracoes", destino: "profiles" },
];

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("embed ambíguo (2ª ligação para a mesma tabela)", () => {
  const fontes = arquivos(join(process.cwd(), "src"))
    .filter((p) => !p.includes("__tests__"))
    .map((p) => ({ p, t: readFileSync(p, "utf8") }));

  it("a régua lê o código (senão 'nenhum problema' não prova nada)", () => {
    expect(fontes.length).toBeGreaterThan(100);
  });

  for (const { origem, destino } of AMBIGUOS) {
    it(`${origem} → ${destino} sempre com o nome da ligação`, () => {
      const semNome = new RegExp(`\\b${destino}\\(`); // "profiles(" sem "!"
      const achados: string[] = [];
      let consultas = 0;
      for (const { p, t } of fontes) {
        // (a) .from("origem") … .select("…") — o primeiro select depois do from.
        for (const m of t.matchAll(new RegExp(`from\\(\\s*["'\`]${origem}["'\`]\\s*\\)[\\s\\S]{0,200}?\\.select\\(\\s*(["'\`])([\\s\\S]*?)\\1`, "g"))) {
          consultas++;
          if (semNome.test(m[2])) achados.push(`${p}: ${m[2].slice(0, 80)}`);
        }
        // (b) origem( … destino( … ) embutido dentro de outra consulta.
        for (const m of t.matchAll(new RegExp(`\\b${origem}\\(([^)]*\\([^)]*\\))*[^)]*\\)`, "g"))) {
          consultas++;
          if (semNome.test(m[0])) achados.push(`${p}: ${m[0].slice(0, 80)}`);
        }
      }
      expect(consultas).toBeGreaterThan(0); // a régua precisa ter achado consultas
      expect(achados).toEqual([]);
    });
  }
});
