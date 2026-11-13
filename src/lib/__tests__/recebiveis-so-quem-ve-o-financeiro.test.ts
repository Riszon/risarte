import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 0403 — achado de 13/11/2026: ASB, TSB, Comprador, o comercial, o Planner,
// o SDR e o Coordenador liam pela API as parcelas, os recebimentos e as
// renegociações dos pacientes, porque as regras de leitura liberavam
// `user_full_access_clinic_ids()` (qualquer papel que não seja dentista nem
// RisLife). A tela não mostrava; a API, sim.
//
// A régua: a ÚLTIMA migração que (re)cria cada uma destas regras tem de
// perguntar `can_see_receivables` e não pode voltar a liberar pela lista de
// acesso total da unidade. A prova no banco (por papel) é
// `scripts/recebiveis-ensaio-0403.mjs`.

const pasta = join(process.cwd(), "supabase", "migrations");
// As faixas não seguem a ordem do nome: a 4004 (Asaas) criou `charges_select`
// e `payment_waivers_select` ANTES da 0403 existir. Ela vem primeiro aqui.
const ANTES_DA_0403 = new Set(["4004_asa1_cobrancas_travas_e_dispensa.sql"]);
const arquivos = readdirSync(pasta)
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => Number(!ANTES_DA_0403.has(a)) - Number(!ANTES_DA_0403.has(b)) || a.localeCompare(b));

function semComentarios(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

/** O texto da última `create policy "<nome>" ... ;` nas migrações. */
function ultimaRegra(nome: string): { arquivo: string; texto: string } {
  let achado: { arquivo: string; texto: string } | null = null;
  const re = new RegExp(`create\\s+policy\\s+"${nome}"[\\s\\S]*?;`, "gi");
  for (const f of arquivos) {
    const sql = semComentarios(readFileSync(join(pasta, f), "utf8"));
    for (const m of sql.matchAll(re)) achado = { arquivo: f, texto: m[0].toLowerCase() };
  }
  // Régua que não acha o que medir tem de gritar, nunca responder "ok".
  if (!achado) throw new Error(`nenhuma migração cria a regra "${nome}" — não consegui medir`);
  return achado;
}

const SO_FINANCEIRO = [
  "payment_receipts_select",
  "payment_renegotiations_select",
  "charges_select",
  "payment_waivers_select",
];

describe("recebíveis só para quem vê o financeiro do cliente (0403)", () => {
  for (const nome of SO_FINANCEIRO) {
    it(`${nome}: só quem vê o financeiro da unidade`, () => {
      const r = ultimaRegra(nome);
      expect(r.texto, `${nome} (${r.arquivo})`).toContain("can_see_receivables(clinic_id)");
      expect(r.texto, `${nome} (${r.arquivo})`).not.toContain("user_full_access_clinic_ids");
      expect(r.texto, `${nome} (${r.arquivo})`).not.toContain("payment_installments");
    });
  }

  it("parcelas: o financeiro, ou só o parcelamento da venda", () => {
    const r = ultimaRegra("payment_installments_select");
    expect(r.texto).toContain("can_see_receivables(clinic_id)");
    expect(r.texto).toContain("can_see_sale_schedule(clinic_id, negotiation_id, direct_sale_id)");
    expect(r.texto).not.toContain("user_full_access_clinic_ids");
  });

  it("as duas regras não respondem a quem não entrou", () => {
    const sql = arquivos
      .map((f) => semComentarios(readFileSync(join(pasta, f), "utf8")).toLowerCase())
      .join("\n");
    for (const fn of ["can_see_receivables(uuid)", "can_see_sale_schedule(uuid, uuid, uuid)"]) {
      expect(sql).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
    }
  });

  it("o parcelamento da venda não abre o financeiro: exige a venda na linha", () => {
    const sql = semComentarios(
      readFileSync(join(pasta, "0403_recebiveis_so_para_quem_ve_o_financeiro.sql"), "utf8")
    ).toLowerCase();
    const corpo = sql.slice(sql.indexOf("function public.can_see_sale_schedule"));
    expect(corpo).toContain("(p_negotiation_id is not null or p_direct_sale_id is not null)");
    // Quem só trabalha a venda direta (SDR, Coordenador) não lê a negociação.
    expect(corpo).toMatch(/p_direct_sale_id is not null and \(\s*public\.has_role_in_clinic\(p_clinic_id, array\['clinical_coordinator'\]/);
    // E ninguém de fora do financeiro aparece em can_see_receivables.
    const receb = sql.slice(sql.indexOf("function public.can_see_receivables"), sql.indexOf("function public.can_see_sale_schedule"));
    for (const papel of ["asb", "tsb", "purchaser", "sdr", "clinical_coordinator", "commercial_consultant", "planner"]) {
      expect(receb).not.toContain(`'${papel}'`);
    }
  });
});
