import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUT_PRESETS,
  aplicarPrioridade,
  gutScore,
  gutTier,
  notasDaFaixa,
  type GutTier,
  type ItemComPrioridade,
} from "@/lib/gut";
import { mensagemDoPlano } from "@/lib/odontograma/plano";

// Pedido do dono (31/10/2026, migração 0339): a prioridade rápida e obrigatória.

const raiz = process.cwd();
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase", "migrations", "0339_prioridade_obrigatoria_no_plano.sql");
const tela = ler("src", "app", "(app)", "prontuarios", "[id]", "planning-section.tsx");
const lista = ler("src", "app", "(app)", "prontuarios", "[id]", "prioridades-do-plano.tsx");
const acoes = ler("src", "app", "(app)", "prontuarios", "[id]", "planning-actions.ts");

const NOTA = { gutGravity: 4, gutUrgency: 4, gutTendency: 4 };
const item = (id: string, procedureId: string | null, extra: Partial<ItemComPrioridade> = {}): ItemComPrioridade => ({
  id,
  procedureId,
  ...extra,
});
const notasDe = (lista: ItemComPrioridade[], id: string) => lista.find((i) => i.id === id)!;

describe("um clique na faixa", () => {
  it("cada faixa preenche notas que caem nela mesma", () => {
    for (const faixa of ["high", "medium", "low"] as GutTier[]) {
      const n = notasDaFaixa({}, faixa);
      expect(gutTier(gutScore(n))).toBe(faixa);
      expect(n.gutGravity).toBe(GUT_PRESETS[faixa].gravity);
    }
  });

  it("clicar na faixa em que já está guarda as notas ajustadas", () => {
    const ajustada = { gutGravity: 3, gutUrgency: 4, gutTendency: 4 };
    expect(notasDaFaixa(ajustada, "high")).toEqual(ajustada);
  });

  it("clicar em outra faixa troca as notas", () => {
    expect(notasDaFaixa({ gutGravity: 3, gutUrgency: 4, gutTendency: 4 }, "low")).toEqual({
      gutGravity: 2,
      gutUrgency: 2,
      gutTendency: 2,
    });
  });
});

describe("repetir dentro do plano", () => {
  it("o igual sem nota recebe a nota, marcado como repetida; a origem não leva marca", () => {
    const r = aplicarPrioridade([item("a", "p"), item("b", "p")], "a", NOTA);
    expect(notasDe(r, "a")).toMatchObject({ ...NOTA, gutRepeated: false });
    expect(notasDe(r, "b")).toMatchObject({ ...NOTA, gutRepeated: true });
  });

  it("outro procedimento não muda", () => {
    const r = aplicarPrioridade([item("a", "p"), item("b", "outro")], "a", NOTA);
    expect(gutScore(notasDe(r, "b"))).toBeNull();
  });

  it("nota dada pelo Planner nunca é sobrescrita", () => {
    const dada = { gutGravity: 5, gutUrgency: 5, gutTendency: 5, gutRepeated: false };
    const r = aplicarPrioridade([item("a", "p"), item("b", "p", dada)], "a", NOTA);
    expect(notasDe(r, "b")).toMatchObject(dada);
  });

  it("a repetida acompanha a correção de um clique errado", () => {
    const repetida = { gutGravity: 2, gutUrgency: 2, gutTendency: 2, gutRepeated: true };
    const r = aplicarPrioridade([item("a", "p"), item("b", "p", repetida)], "a", NOTA);
    expect(notasDe(r, "b")).toMatchObject({ ...NOTA, gutRepeated: true });
  });

  it("clicar na repetida confirma: a marca sai", () => {
    const repetida = { ...NOTA, gutRepeated: true };
    const r = aplicarPrioridade([item("a", "p", repetida)], "a", NOTA);
    expect(notasDe(r, "a").gutRepeated).toBe(false);
  });

  it("item antigo sem procedimento não puxa outro sem procedimento", () => {
    const r = aplicarPrioridade([item("a", null), item("b", null)], "a", NOTA);
    expect(gutScore(notasDe(r, "b"))).toBeNull();
  });
});

describe("o banco (0339)", () => {
  const envio = sql.slice(sql.indexOf("function public.submit_treatment_plan"));

  it("o envio recusa item sem qualquer uma das três notas, antes de mudar a situação", () => {
    const trava = envio.indexOf("raise exception 'GUT_REQUIRED'");
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(envio.indexOf("set status = 'submitted'"));
    const bloco = envio.slice(envio.lastIndexOf("if exists", trava), trava);
    expect(bloco).toContain("i.gut_gravity is null or i.gut_urgency is null or i.gut_tendency is null");
    // Todas as opções do plano, não só a principal.
    expect(bloco).toContain("o.plan_id = p_plan_id");
    expect(bloco).not.toContain("is_primary");
  });

  it("a recriação do envio mantém as travas anteriores", () => {
    for (const c of ["SEQUENCE_REQUIRED", "ITEM_LOCATION_REQUIRED", "DIAGNOSIS_NOT_FINALIZED", "OPTION_NEEDS_ITEMS"]) {
      expect(envio).toContain(`raise exception '${c}'`);
    }
    expect(envio).toContain("public.group_adjusted_price(");
  });

  it("a porta exige as três notas, o plano editável e fecha para quem não está logado", () => {
    const porta = sql.slice(sql.indexOf("function public.set_plan_item_priority"), sql.indexOf("function public.plan_item_repeat_priority"));
    expect(porta).toContain("raise exception 'INVALID_PRIORITY'");
    expect(porta).toContain("raise exception 'PLAN_LOCKED'");
    expect(porta).toContain("raise exception 'NOT_ALLOWED'");
    expect(porta).toMatch(/revoke execute on function public\.set_plan_item_priority\([^)]*\)\s+from public, anon, authenticated/);
  });

  it("a prioridade tranca com o plano", () => {
    const trava = sql.slice(sql.indexOf("function public.plan_item_lock"), sql.indexOf("function public.submit_treatment_plan"));
    expect(trava).toContain("new.gut_gravity, new.gut_urgency, new.gut_tendency, new.gut_repeated");
    expect(trava).toContain("old.gut_gravity, old.gut_urgency, old.gut_tendency, old.gut_repeated");
  });

  it("o item novo aproveita a nota por gatilho, só quando vem sem nota", () => {
    expect(sql).toContain("before insert on public.treatment_plan_option_items");
    expect(sql).toContain("new.gut_gravity is not null or new.gut_urgency is not null or new.gut_tendency is not null");
  });

  it("as recusas têm texto para a tela", () => {
    expect(mensagemDoPlano("GUT_REQUIRED")).toMatch(/prioridade/i);
    expect(mensagemDoPlano("INVALID_PRIORITY")).toMatch(/três notas/i);
  });
});

describe("a tela", () => {
  it("o clique não recarrega a ficha: gravar a nota não revalida", () => {
    const acao = acoes.slice(acoes.indexOf("export async function definirPrioridadeDoItem"));
    expect(acao.slice(0, acao.indexOf("\n}\n"))).not.toContain("revalidatePath");
    expect(lista).not.toMatch(/mudar[^}]*router\.refresh/);
    expect(acoes).not.toContain("setItemGut");
  });

  it("nada muda de lugar na lista: ela não ordena pela prioridade", () => {
    expect(lista).not.toContain("sortByGutDesc");
  });

  it("o estado da lista fica fora da janela, que desmonta ao fechar", () => {
    expect(lista.indexOf("const [itens, setItens]")).toBeLessThan(lista.indexOf("<Dialog"));
    expect(lista).toContain("grid-cols-1");
  });

  it("nota pela metade não chega ao banco", () => {
    expect(lista).toMatch(/gutScore\(proximo\) == null\) \{\s+setRascunho/);
  });

  it("o botão de enviar espera a prioridade, e a tela diz quantos faltam", () => {
    expect(tela).toContain("semPrioridade > 0 || isPending");
    expect(tela).toContain("Falta definir a prioridade de");
    expect(tela).not.toContain("GutPicker");
  });
});
