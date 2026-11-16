import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INDICADORES,
  aproveitadaPara,
  lerAproveitadas,
  progressoDaMissao,
  type TarefaAproveitada,
} from "@/lib/certificacao";
import { deveRegistrarConclusao, lerRetrato, retratoDaMedicao } from "@/lib/certificacao-conclusao";

// AP172 (pedido do dono no OC-00016, 16/11/2026), migração 0412: quem já é
// certificado numa função e é convocado para outra pode aproveitar as
// tarefas em comum — escolha do Admin, pessoa por pessoa (D1).

const ROOT = join(__dirname, "..", "..", "..");
const MIGRACAO = readFileSync(
  join(ROOT, "supabase/migrations/0412_certificacao_aproveita_tarefas.sql"),
  "utf8"
).replace(/\r\n/g, "\n");

const [a, b] = INDICADORES;
const missao = [
  { indicador: a, minimo: 5 },
  { indicador: b, minimo: 2 },
];
const aproveitada: TarefaAproveitada = {
  chave: a.chave,
  role: "dentist",
  certified_at: "2026-10-01T12:00:00Z",
  minimo: 5,
  feito: 6,
};

describe("a tarefa aproveitada conta sem ir ao treino", () => {
  it("entra cumprida, com o número de onde veio e a função", () => {
    const p = progressoDaMissao(missao, { [b.chave]: { ok: true, feito: 2 } }, [aproveitada]);
    const item = p.itens.find((i) => i.chave === a.chave)!;
    expect(item).toMatchObject({ feito: 6, cumprido: true, aproveitadoDe: "dentist" });
    expect(p.cumprida).toBe(true);
    expect(deveRegistrarConclusao({ estado: "medido", progresso: p })).toBe(true);
  });

  it("sem aproveitamento, a missão continua exigindo a contagem", () => {
    const p = progressoDaMissao(missao, { [b.chave]: { ok: true, feito: 2 } });
    expect(p.cumprida).toBe(false);
    expect(p.itens.find((i) => i.chave === a.chave)?.feito).toBeNull();
  });

  it("meta aumentada depois da convocação volta a ser medida", () => {
    expect(aproveitadaPara(a.chave, 6, [aproveitada])).not.toBeNull();
    expect(aproveitadaPara(a.chave, 7, [aproveitada])).toBeNull();
  });

  it("o retrato guarda de onde veio, e a leitura devolve", () => {
    const p = progressoDaMissao(missao, { [b.chave]: { ok: true, feito: 2 } }, [aproveitada]);
    const retrato = retratoDaMedicao(p, new Date("2026-11-16T12:00:00Z"));
    expect(retrato.itens.find((i) => i.chave === a.chave)).toMatchObject({ aproveitado_de: "dentist" });
    expect(lerRetrato(retrato).find((i) => i.chave === a.chave)?.aproveitadoDe).toBe("dentist");
    expect(lerRetrato(retrato).find((i) => i.chave === b.chave)?.aproveitadoDe).toBeUndefined();
  });

  it("lê reused_items sem confiar no formato", () => {
    expect(lerAproveitadas(null)).toEqual([]);
    expect(lerAproveitadas([{ chave: "x" }, aproveitada])).toEqual([aproveitada]);
  });
});

describe("a regra do banco (0412)", () => {
  it("D2: só aproveita quando a outra exigiu pelo menos o mesmo número e foi cumprida", () => {
    expect(MIGRACAO).toContain("(i ->> 'minimo')::int >= r.minimum_count");
    expect(MIGRACAO).toContain("(i ->> 'feito')::int >= (i ->> 'minimo')::int");
    expect(MIGRACAO).toContain("c.role <> p_role");
  });

  it("D3: só novatos, na prévia e na abertura", () => {
    expect(MIGRACAO).toContain("if p_kind is distinct from 'novatos' then");
    expect(MIGRACAO).toContain("REUSE_ONLY_FOR_NEWCOMERS");
  });

  it("D1: só quem o Admin marcou recebe o aproveitamento; o resto, missão completa", () => {
    expect(MIGRACAO).toMatch(/= any\(coalesce\(p_reduced, '\{\}'::text\[\]\)\)\s*then public\._training_reusable_items/);
    expect(MIGRACAO).toContain("else '[]'::jsonb");
  });

  it("a regra interna não responde à API; a prévia é só do Admin", () => {
    expect(MIGRACAO).toContain(
      "revoke execute on function public._training_reusable_items(uuid, public.user_role) from public, anon, authenticated;"
    );
    expect(MIGRACAO).toMatch(/training_reuse_preview[\s\S]*?if not public\.is_admin_master\(\) then/);
  });
});
