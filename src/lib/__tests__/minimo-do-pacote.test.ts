import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  minimoValido,
  pacotesAbaixoDoMinimo,
  pisoDoPacote,
  type ItemNaNegociacao,
} from "@/lib/procedimentos/grupos";

// O MÍNIMO DO PACOTE (0326, pedido do dono, 27/10/2026). Decisões GP7–GP8:
// TRAVA a negociação (autorização do Gerente) e é guardado em % da tabela.

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

const pacote = { id: "g", nome: "Pacote ensaio 0326", minimoPercent: 80 };
const item = (p: Partial<ItemNaNegociacao> = {}): ItemNaNegociacao => ({
  pacote,
  quantidade: 1,
  precoCents: 90000,
  precoDeTabelaCents: 100000,
  beneficioCents: 0,
  incluido: true,
  ...p,
});

describe("o piso e os limites", () => {
  it("o piso arredonda PARA CIMA (o mínimo não cede centavo)", () => {
    expect(pisoDoPacote(200000, 80)).toBe(160000);
    expect(pisoDoPacote(33333, 80)).toBe(26667); // 26.666,4
    expect(pisoDoPacote(100001, 12.5)).toBe(12501); // 12.500,125
  });

  it("o mínimo não passa do preço do pacote, nem sai dos limites do banco", () => {
    expect(minimoValido(null, -10)).toBeNull();
    expect(minimoValido(80, -10)).toBeNull();
    expect(minimoValido(90, -10)).toBeNull();
    expect(minimoValido(90.01, -10)).toMatch(/acima do preço do pacote/);
    expect(minimoValido(0, 0)).toMatch(/0,01%/);
    expect(minimoValido(200.01, 100)).toMatch(/0,01%/);
    expect(minimoValido(110, 15)).toBeNull(); // acréscimo: o mínimo pode passar de 100%
  });
});

describe("a conta da negociação (a mesma do ensaio da 0326)", () => {
  const dois = [item(), item()]; // tabela 200.000, pacote 180.000, mínimo 160.000

  it("sem desconto, dentro do mínimo", () => {
    expect(pacotesAbaixoDoMinimo(dois, 0, 180000)).toEqual([]);
  });

  it("desconto que leva EXATAMENTE ao mínimo passa; um centavo abaixo pede autorização", () => {
    expect(pacotesAbaixoDoMinimo(dois, -20000, 180000)).toEqual([]);
    expect(pacotesAbaixoDoMinimo(dois, -20001, 180000)).toEqual([
      // O MESMO texto que o banco grava (o Gerente lê um, o Comercial o outro).
      "Pacote ensaio 0326 abaixo do mínimo: R$ 1.599,99 (mínimo R$ 1.600,00, 80% da tabela)",
    ]);
  });

  it("o desconto se reparte pela base descontável", () => {
    expect(pacotesAbaixoDoMinimo(dois, -40000, 360000)).toEqual([]);
    expect(pacotesAbaixoDoMinimo(dois, -40004, 360000)).toHaveLength(1);
  });

  it("benefício do programa não é desconto do Comercial, e o item fica fora da base", () => {
    const tres = [...dois, item({ beneficioCents: 9000 })]; // tabela 300.000 → mínimo 240.000; preço 270.000
    expect(pacotesAbaixoDoMinimo(tres, -30000, 180000)).toEqual([]);
    expect(pacotesAbaixoDoMinimo(tres, -30001, 180000)).toHaveLength(1);
  });

  it("item fora da negociação, item solto e grupo sem mínimo não contam", () => {
    expect(
      pacotesAbaixoDoMinimo(
        [...dois, item({ incluido: false, precoDeTabelaCents: 1000000, precoCents: 10 })],
        0,
        180000
      )
    ).toEqual([]);
    expect(pacotesAbaixoDoMinimo([item({ pacote: null, precoCents: 1 })], 0, 1)).toEqual([]);
    expect(pacotesAbaixoDoMinimo([item({ pacote: { ...pacote, minimoPercent: null }, precoCents: 1 })], 0, 1)).toEqual([]);
  });

  it("acréscimo manual não reduz o pacote", () => {
    expect(pacotesAbaixoDoMinimo(dois, 50000, 180000)).toEqual([]);
  });
});

describe("o banco e as telas seguem a mesma regra", () => {
  const sql = ler("supabase/migrations/0326_minimo_do_pacote.sql");

  it("a regra da negociação chama o mínimo ANTES de gravar o status", () => {
    const ev = sql.slice(sql.indexOf("create or replace function public.evaluate_negotiation_rules"));
    const chamada = ev.indexOf("public._negotiation_package_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable)");
    expect(chamada).toBeGreaterThan(0);
    expect(chamada).toBeLessThan(ev.indexOf("update public.plan_negotiations set"));
    // a 0182 continua inteira: teto, parcelas, meio, parcela mínima
    for (const trecho of ["acima do máximo permitido", "Parcelamento em", "não permitido pela regra comercial", "abaixo do mínimo de R$"]) {
      expect(ev).toContain(trecho);
    }
  });

  it("o texto do banco é o mesmo da tela", () => {
    expect(sql).toContain("'%s abaixo do mínimo: %s (mínimo %s, %s%% da tabela)'");
    expect(sql).toMatch(/ceil\(tabela \* minimo \/ 100\)/);
  });

  it("só o Admin Master define preço e mínimo; a regra interna não é chamável", () => {
    const porta = sql.slice(sql.indexOf("function public.set_procedure_group_pricing("), sql.indexOf("function public.set_procedure_group_price("));
    expect(porta).toMatch(/if not public\.is_admin_master\(\) then\s+raise exception 'PRICE_NOT_ALLOWED'/);
    expect(porta).toContain("MIN_ABOVE_PRICE");
    expect(sql).toMatch(/revoke execute on function public\._negotiation_package_floor\(uuid, integer, integer\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\._negotiation_package_floor/);
  });

  it("o painel avisa antes de salvar, com o mínimo lido à parte", () => {
    const painel = ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx");
    expect(painel).toMatch(/\.\.\.pacotesAbaixoDoMinimo\(/);
    const loader = ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts");
    expect(loader).toMatch(/select\("id, min_price_percent"\)/);
    const db = ler("src/lib/procedimentos/grupos-db.ts");
    expect(db).toMatch(/select\("id, min_price_percent"\)/);
  });

  it("o repasse do pacote vem da mesma fonte do cartão do procedimento, em % do preço NO pacote", () => {
    const page = ler("src/app/(app)/procedimentos/grupos/page.tsx");
    expect(page).toMatch(/rpc\("payout_matrix"/);
    const repasse = ler("src/app/(app)/procedimentos/grupos/repasse-do-pacote.tsx");
    expect(repasse).toMatch(/precoNoPacote\(precoDe\.get\(i\.procedureId\) \?\? 0, ajustePercent\)/);
    // nível sem repasse em nenhum procedimento: "sem repasse", não "R$ 0,00 · 0%"
    expect(repasse).toMatch(/if \(comRepasse\.length === 0\) \{[\s\S]{0,120}celula\(null,/);
    // e também sobre o MÍNIMO do pacote (pedido do dono, 27/10/2026)
    expect(repasse).toMatch(/textoDosPercentuais\(valorCents, baseCents, minimoCents,/);
    expect(repasse).toMatch(/minimoCents: minimoPercent \? pisoDoPacote\(tabelaCents, minimoPercent\) : null/);
    expect(ler("src/app/(app)/procedimentos/grupos/grupos-editor.tsx")).toMatch(/minimoPercent=\{grupo\.minimoPercent \?\? null\}/);
  });

  it("o botão rápido usa a porta do editor e a permissão do GP1", () => {
    const acoes = ler("src/app/(app)/procedimentos/grupos/actions.ts");
    const fn = acoes.slice(acoes.indexOf("export async function vincularAoGrupo"));
    expect(fn).toMatch(/if \(!podeMexer\(session\)\)/);
    expect(fn).toMatch(/return salvarGrupo\(/);
    expect(fn).toMatch(/\[\.\.\.atuais, \{ procedureId: input\.procedureId, quantidade: 1 \}\]/); // entra no FIM
    const page = ler("src/app/(app)/procedimentos/page.tsx");
    expect(page).toMatch(/podeVincularGrupo=\{canSeeCatalog\}/);
    expect(ler("src/app/(app)/procedimentos/procedures-editor.tsx")).toMatch(/<GruposDoProcedimento/);
  });
});
