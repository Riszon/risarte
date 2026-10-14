import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Relato OC-00091 (28/09/2026, treino): a apresentação de AMANHÃ, iniciada hoje
// pelo funil, ficou "em atendimento" depois da venda concluída — fora do quadro
// do dia — e o consultor não conseguia chamar o próximo cliente.
//
// O comportamento no banco foi provado em transação desfeita no treino
// (14/10/2026): iniciar, regra do ocupado, venda concluída pela assistente,
// follow-up, follow-up de quem não foi apresentado e "apresentado". Estas
// réguas prendem o TEXTO que garante isso, para ninguém desfazer sem ver.

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MIG = ler("supabase/migrations/0293_fim_da_apresentacao.sql");

describe("0293 — o funil encerra a apresentação", () => {
  it("follow-up também encerra (decisão do dono), junto com apresentado, cancelado e perdido", () => {
    expect(MIG).toMatch(
      /elsif p_stage in \('apresentado', 'cancelado', 'perdido', 'follow_up'\) then\s+(--[^\n]*\n\s+)*perform public\.update_attendance\(v_appt, 'done'\)/
    );
  });
  it("para encerrar, procura primeiro o atendimento ABERTO de qualquer dia", () => {
    expect(MIG).toMatch(
      /if p_stage in \('apresentado', 'cancelado', 'perdido', 'follow_up'\) then\s+select a\.id into v_appt[\s\S]{0,200}and a\.attendance = 'in_service'/
    );
  });
  it("follow-up NÃO marca como feita a apresentação que nem começou", () => {
    expect(MIG).toMatch(/if v_appt is null and p_stage <> 'follow_up' then/);
  });
  it("a regra do profissional ocupado não foi mexida (continua no update_attendance)", () => {
    expect(MIG).not.toMatch(/PROVIDER_BUSY/);
    expect(MIG).not.toMatch(/function public\.update_attendance/);
  });
});

describe("0293 — a venda concluída encerra a apresentação", () => {
  it("gatilho na venda, quando closed_at é preenchido", () => {
    expect(MIG).toMatch(/after update of closed_at on public\.commercial_sales/);
    expect(MIG).toMatch(/if not \(new\.closed_at is not null and old\.closed_at is null\) then/);
  });
  it("encerra mesmo quando quem confirma não chamou o cliente (a assistente)", () => {
    expect(MIG).toMatch(/if sqlerrm like '%NOT_CALLER%' then\s+update public\.appointments\s+set attendance = 'done'/);
  });
  it("nunca derruba a venda: todo erro vira aviso", () => {
    const corpo = MIG.slice(MIG.indexOf("function public.commercial_sale_ends_presentation"));
    expect(corpo).toMatch(/exception\s+when others then\s+raise warning 'commercial_sale_ends_presentation: %', sqlerrm;\s+return new;/);
  });
});

describe("a tela de Atendimento", () => {
  const pagina = ler("src/app/(app)/atendimento/page.tsx");
  const painel = ler("src/app/(app)/atendimento/attendance-panel.tsx");
  const acoes = ler("src/app/(app)/agenda/actions.ts");

  it("mostra o que está EM ATENDIMENTO de qualquer dia", () => {
    const bloco = pagina.slice(pagina.indexOf("OC-00091: o que está EM ATENDIMENTO"), pagina.indexOf("H3.4b: pendências"));
    expect(bloco).toMatch(/\.eq\("attendance", "in_service"\)/);
    expect(bloco).not.toMatch(/starts_at", (start|end)/);
  });
  it("o card de outro dia diz para quando estava marcado", () => {
    expect(pagina).toMatch(/scheduledForIso: apptDate > todayIsoDate \? apptDate : null/);
    expect(painel).toMatch(/Marcado para \{scheduledFor\}/);
  });
  it("a recusa diz QUAL atendimento está aberto", () => {
    expect(acoes).toMatch(/PROVIDER_BUSY[\s\S]{0,120}error: await qualAtendimentoEstaAberto\(supabase, appointmentId\)/);
    expect(acoes).toMatch(/ainda está em atendimento com \$\{quem\} — agendamento de \$\{quando\}/);
  });
});
