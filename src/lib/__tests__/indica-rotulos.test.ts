import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ITEM_TIPOS,
  RESGATE_STATUS,
  TIPO_LANCAMENTO_LABEL,
  proximoNivel,
} from "@/lib/indica/rotulos";

const NIVEIS = [
  { codigo: "amigo", nome: "Amigo +Risos", ordem: 1, criterio: 0 },
  { codigo: "embaixador", nome: "Embaixador", ordem: 2, criterio: 1 },
  { codigo: "ouro", nome: "Embaixador Ouro", ordem: 3, criterio: 3 },
  { codigo: "diamante", nome: "Embaixador Diamante", ordem: 4, criterio: 6 },
];

describe("Indica +Risos — próximo nível", () => {
  it("diz quanto falta e o progresso", () => {
    expect(proximoNivel(NIVEIS, 2, 2)).toEqual({ nivel: NIVEIS[2], faltam: 1, progresso: 2 / 3 });
    expect(proximoNivel(NIVEIS, 1, 0)?.faltam).toBe(1);
  });
  it("no último nível não há próximo", () => {
    expect(proximoNivel(NIVEIS, 4, 9)).toBeNull();
  });
  it("recalculo atrasado (já passou do critério) não mostra número negativo", () => {
    expect(proximoNivel(NIVEIS, 2, 5)).toEqual({ nivel: NIVEIS[2], faltam: 0, progresso: 1 });
  });
});

describe("Indica +Risos — rótulos batem com o banco", () => {
  // Um valor que a tela oferece e o banco recusa é um botão que sempre falha.
  const sql = ["2000_indica_estrutura.sql", "2004_indica_embaixadores_resgates.sql"]
    .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
    .join("\n");

  it("status do resgate", () => {
    const m = sql.match(/check \(status in \('solicitado'[^)]*\)\)/);
    expect(m, "check de status dos resgates não encontrado").not.toBeNull();
    for (const s of RESGATE_STATUS) expect(m![0]).toContain(`'${s}'`);
  });

  it("tipos de item do catálogo", () => {
    const m = sql.match(/check \(tipo in \('credito_risarte'[^)]*\)\)/);
    expect(m, "check de tipo do catálogo não encontrado").not.toBeNull();
    for (const t of ITEM_TIPOS) expect(m![0]).toContain(`'${t}'`);
  });

  it("todo tipo de lançamento do banco tem rótulo", () => {
    const blocos = [...sql.matchAll(/pontos_lancamentos_tipo_check\s+check \(tipo in \(([^)]*)\)\)/g)];
    expect(blocos.length, "check de tipo do extrato não encontrado").toBeGreaterThan(0);
    const tipos = [...blocos.at(-1)![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const t of tipos) expect(TIPO_LANCAMENTO_LABEL[t], t).toBeTruthy();
  });
});
