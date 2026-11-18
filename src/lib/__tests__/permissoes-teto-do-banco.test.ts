// O TETO DO BANCO na matriz de permissões (decisão do dono, 18/11/2026: "uma
// marca que o banco recusa não pode existir na tela"). O teto escrito em
// `permissions.ts` tem de ser o mesmo das guardas do banco.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES_POR_ID, bancoAceita } from "@/lib/permissions";

const MIG = "supabase/migrations";
const ultima = (padrao: RegExp) => {
  const arqs = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  let achou = "";
  for (const f of arqs) {
    const s = readFileSync(`${MIG}/${f}`, "utf8");
    const m = s.match(padrao);
    if (m) achou = m[0];
  }
  return achou;
};
const papeisDe = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
const teto = (id: string) => [...(CAPACIDADES_POR_ID.get(id)?.teto ?? [])].sort();

describe("o teto do banco nas permissões do Asaas", () => {
  it("o padrão de toda permissão cabe no teto", () => {
    for (const cap of CAPACIDADES_POR_ID.values()) for (const p of cap.padrao) expect(bancoAceita(cap, p), `${cap.id} · ${p}`).toBe(true);
  });

  it("cobrança: emitir e cancelar batem com a guarda `_charge_can` (4004)", () => {
    const f = ultima(/create or replace function public\._charge_can[\s\S]*?\$\$;/);
    const emitir = f.match(/p_action = 'emit'[^\n]*/)![0];
    const cancelar = f.match(/p_action = 'cancel'[^\n]*/)![0];
    // O Financeiro passa por `is_finance_franchisor()`, fora da lista.
    expect(teto("acao.cobranca.emitir")).toEqual([...papeisDe(emitir).filter((p) => p !== "emit"), "finance_franchisor"].sort());
    expect(teto("acao.cobranca.cancelar")).toEqual([...papeisDe(cancelar).filter((p) => p !== "cancel"), "finance_franchisor"].sort());
    expect(bancoAceita(CAPACIDADES_POR_ID.get("acao.cobranca.cancelar")!, "receptionist")).toBe(false);
  });

  it("as quatro do `_gateway_cap_ceiling` (a definição mais recente) batem com o teto", () => {
    const f = ultima(/create or replace function public\._gateway_cap_ceiling[\s\S]*?\$\$;/);
    for (const id of ["acao.cobranca.selo_atraso", "modulo.painel_cobrancas", "acao.cobranca.estorno", "modulo.repasses_franquia"]) {
      const bloco = f.split(`when '${id}' then`)[1].split(/when '|else/)[0];
      expect(teto(id), id).toEqual(papeisDe(bloco));
    }
  });

  it("a Central: abre para Gerente e Financeiro; só o Gerente grava a chave", () => {
    expect(teto("modulo.central")).toEqual(["finance_franchisor", "unit_manager"]);
    expect(teto("acao.central.vincular_conta")).toEqual(["unit_manager"]);
  });

  it("a prontidão da rede (4022) exige as cinco marcas, sem cancelar para a Recepção", () => {
    const s = readFileSync(`${MIG}/4022_asa7_pecas_do_piloto.sql`, "utf8");
    expect(s).toContain("v_cap <> 'acao.cobranca.cancelar' and not ('receptionist' = any (v_roles))");
    expect(s).not.toMatch(/_gateway_cap_effective_roles[\s\S]{0,400}_gateway_cap_ceiling/);
  });
});
