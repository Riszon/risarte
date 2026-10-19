import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indicadoresDoPapel, lerOrigem } from "@/lib/certificacao";

// Relato OC-00004 (19/10/2026): a lista de tarefas da ASB na certificação
// trazia seis ações que o sistema NUNCA deixou a ASB fazer (nem a tela nem o
// banco liberam): check-in, chamar paciente, anamnese, fotos e exames,
// profissional responsável e desfecho. Uma missão com qualquer uma delas seria
// impossível de cumprir — a ASB ficaria fora do sistema real para sempre.
// Decisão do dono: a ASB cuida do material e pede indicação.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const daAsb = indicadoresDoPapel("asb").map((i) => i.chave);

describe("as tarefas da ASB", () => {
  it("as seis que ela não consegue fazer no sistema saíram", () => {
    for (const fora of [
      "check_ins",
      "chamadas_paciente",
      "anamneses",
      "midias_enviadas",
      "atendimentos_como_profissional",
      "desfechos_atendimento",
    ]) {
      expect(daAsb, fora).not.toContain(fora);
    }
  });

  it("as do material e da indicação entraram", () => {
    for (const dentro of [
      "pedidos_franqueadora",
      "pedidos_locais",
      "entradas_estoque",
      "envios_para_uso",
      "inventarios",
      "ajustes_saldo",
      "pedidos_indicacao",
      "consumo_avulso",
    ]) {
      expect(daAsb, dentro).toContain(dentro);
    }
  });

  it("pedido para a franqueadora e pedido local são contados separados", () => {
    const porChave = new Map(indicadoresDoPapel("asb").map((i) => [i.chave, i]));
    expect(lerOrigem(porChave.get("pedidos_franqueadora")!.origem).filtros).toEqual([
      { coluna: "is_local", valor: "false" },
    ]);
    expect(lerOrigem(porChave.get("pedidos_locais")!.origem).filtros).toEqual([
      { coluna: "is_local", valor: "true" },
    ]);
  });

  it("enviar para uso conta a abertura, não o acerto da embalagem anterior", () => {
    const envio = indicadoresDoPapel("asb").find((i) => i.chave === "envios_para_uso")!;
    expect(lerOrigem(envio.origem).filtros).toEqual([
      { coluna: "source_type", valor: "abertura" },
      { coluna: "kind", valor: "abertura" },
    ]);
  });

  it("ajuste de saldo conta entrada E saída, e só o lançado à mão", () => {
    const ajuste = indicadoresDoPapel("asb").find((i) => i.chave === "ajustes_saldo")!;
    expect(lerOrigem(ajuste.origem).filtros).toEqual([
      { coluna: "source_type", valor: "manual" },
      { coluna: "kind", valor: "ajuste_entrada|ajuste_saida" },
    ]);
  });

  it("valor com '|' vira 'qualquer um destes' na contagem e na régua", () => {
    expect(ler("src/lib/certificacao-contagem.ts")).toContain(
      '? consulta.in(f.coluna, f.valor.split("|"))'
    );
    expect(ler("scripts/conferir-indicadores.mjs")).toContain('for (const v of f.valor.split("|")) {');
    expect(ler("scripts/conferir-indicadores.mjs")).toContain(
      "where table_schema in ('public', 'empresarial', 'indica')"
    );
  });

  it("a régua de permissão continua sem a ASB nas seis ações (o que a lista refletia)", () => {
    // Se um dia a ASB ganhar uma destas, a lista da certificação pode voltar
    // a oferecê-la — mas por decisão, não por engano.
    const ag = ler("src/lib/appointments.ts");
    const i = ag.indexOf("export const TYPE_PROVIDER_ROLES");
    expect(i).toBeGreaterThan(-1);
    expect(ag.slice(i, ag.indexOf("};", i))).not.toContain("asb");
    expect(ler("supabase/migrations/0111_clinical_media_dentist.sql")).toContain(
      "array['clinical_coordinator','dentist']::public.user_role[]"
    );
  });
});
