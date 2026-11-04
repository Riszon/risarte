import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AP64, passo 2 (decisões do dono, 03/11/2026; C1–C4 em
// docs/comercial/AP63-AP64-PLANO.md §6): o Consultor apresenta, negocia e
// fecha o plano complementar com o cliente em tratamento (Fase 5). A
// apresentação é PRÓPRIA do complemento (C1); o fechamento não mexe na fase.
// Comportamento do banco provado no treino (ensaio da 0357, transação
// desfeita, 13/13; sem a 0357, 8 reprovam).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0357_plano_complementar_apresentar_e_fechar.sql");

describe("AP64 passo 2 — o banco (0357)", () => {
  it("a apresentação do complemento é própria e só aceita plano complementar", () => {
    expect(sql).toContain("create table if not exists public.plan_complement_presentations");
    expect(sql).toContain("plan_id uuid not null unique references public.treatment_plans (id)");
    expect(sql).toContain("raise exception 'NOT_A_COMPLEMENT'");
    expect(sql).toContain("select public.audit_attach_all();");
  });

  it("aprovado, o complemento fica aguardando apresentação e os Consultores são avisados", () => {
    expect(sql).toContain("set lifecycle = 'aguardando_apresentacao'");
    expect(sql).toContain("'Plano complementar para apresentar'");
    expect(sql).toContain("providers_with_access(new.clinic_id, 'commercial_consultant')");
  });

  it("o aceite do complemento exige a Fase 5 e o resumo DELE", () => {
    const i = sql.indexOf("create or replace function public.accept_negotiation(");
    const corpo = sql.slice(i, sql.indexOf("$$;", i));
    expect(corpo).toContain("if v_client_phase <> 'treatment_start' then raise exception 'WRONG_PHASE'; end if;");
    expect(corpo).toContain("from public.plan_complement_presentations cp\n      where cp.plan_id = v_neg.plan_id");
    // o plano comum continua exigindo a Fase 4 e o resumo do cliente
    expect(corpo).toContain("elsif v_client_phase <> 'commercial_conversion' then");
    expect(corpo).toContain("where cp.client_id = v_neg.client_id");
  });

  it("o fechamento do complemento não mexe na fase do cliente", () => {
    const i = sql.indexOf("create or replace function public._commercial_close_step_raw(");
    const corpo = sql.slice(i, sql.indexOf("$$;", i));
    expect(corpo).toMatch(/if not v_complemento then\s+update public\.journey_phase_history/);
    expect(corpo).toContain("'Complemento fechado — agendar'");
  });
});

describe("AP64 passo 2 — as telas", () => {
  it("o cockpit tem o modo complemento", () => {
    const p = ler("src/app/(app)/comercial/[clientId]/page.tsx");
    expect(p).toContain("complemento: complementoPedido");
    expect(p).toContain('const inCommercialPhase = phase === "commercial_conversion" || modoComplemento != null;');
    expect(p).toContain("loadNegotiationBlock(clientId, clinicId, modoComplemento?.id ?? null)");
    expect(p).toContain("lerApresentacao(supabase, clientId, modoComplemento?.id ?? null)");
    expect(p).toContain("complementoId={modoComplemento?.id ?? null}");
    expect(p).toContain("ehComplemento={modoComplemento != null}");
  });

  it("a apresentação do complemento é salva na tabela dele, e a negociação aceita a Fase 5", () => {
    expect(ler("src/app/(app)/comercial/[clientId]/actions.ts")).toContain('.from("plan_complement_presentations").upsert(');
    const n = ler("src/app/(app)/apresentacao/[clientId]/negotiation-actions.ts");
    expect(n).toContain('? client.journey_phase === "treatment_start"');
  });

  it("o contrato do complemento leva o resumo da apresentação dele (C2)", () => {
    expect(ler("src/lib/signatures/envio-dados.ts")).toContain("complementoDaNegociacao(supabase, negotiation?.plan_id ?? planId)");
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts")).toContain(
      "const presRow = await lerApresentacao(supabase, clientId, complementoId);"
    );
  });

  it("o complemento não oferece 'Devolver ao planejamento'", () => {
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx")).toContain("{!ehComplemento && (");
  });

  it("o quadro do Comercial tem a coluna Complementos (C4)", () => {
    const q = ler("src/app/(app)/comercial/page.tsx");
    expect(q).toContain("<ComplementosColuna cartoes={cartoesDeComplemento} />");
    expect(q).toContain('cliente?.journey_phase === "treatment_start" && !venda?.closed_at');
  });
});
