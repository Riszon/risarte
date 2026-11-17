import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  TYPE_PROVIDER_ROLES,
  appointmentTypeOptions,
} from "@/lib/appointments";
import {
  dicaDoTipo,
  emSeguida,
  horarioEmSeguida,
  manutencaoDaSemana,
  type OrtoNaAgenda,
} from "@/lib/ortodontia/agenda";

// AP176 (0425, 17/11/2026): o tipo "Manutenção ortodôntica" e as dicas da agenda.

const orto: OrtoNaAgenda = {
  status: "em_tratamento",
  orthodontistId: "orto-1",
  orthodontistName: "Dra. Orto",
  previstas: ["2026-11-20", "2026-12-20"],
};

describe("o tipo novo", () => {
  it("existe, tem rótulo e é atendido por dentista e Coordenador (como o retorno)", () => {
    expect(APPOINTMENT_TYPES).toContain("ortho_maintenance");
    expect(APPOINTMENT_TYPE_LABELS.ortho_maintenance).toBe("Manutenção ortodôntica");
    expect(TYPE_PROVIDER_ROLES.ortho_maintenance).toEqual(TYPE_PROVIDER_ROLES.return_visit);
  });

  it("só aparece para quem tem caso aberto, logo depois do tipo da fase", () => {
    expect(appointmentTypeOptions("treatment_start")).not.toContain("ortho_maintenance");
    const com = appointmentTypeOptions("treatment_start", { orthoOpen: true });
    expect(com[0]).toBe("treatment_start");
    expect(com[1]).toBe("ortho_maintenance");
    // Em acompanhamento (Fase 7, contenção) também.
    expect(appointmentTypeOptions("follow_up", { orthoOpen: true })).toContain("ortho_maintenance");
    // Sem repetir.
    expect(com.filter((t) => t === "ortho_maintenance")).toHaveLength(1);
  });
});

describe("a pergunta do hábito antigo", () => {
  it("sessão ou retorno COM o ortodontista de quem tem caso → pergunta", () => {
    expect(dicaDoTipo({ type: "treatment_session", providerId: "orto-1", orto })).toMatch(/Manutenção ortodôntica/);
    expect(dicaDoTipo({ type: "return_visit", providerId: "orto-1", orto })).not.toBeNull();
  });
  it("outro dentista, outro tipo ou sem caso → nada", () => {
    expect(dicaDoTipo({ type: "treatment_session", providerId: "outro", orto })).toBeNull();
    expect(dicaDoTipo({ type: "ortho_maintenance", providerId: "orto-1", orto })).toBeNull();
    expect(dicaDoTipo({ type: "treatment_session", providerId: "orto-1", orto: null })).toBeNull();
  });
});

describe("dois atendimentos seguidos no mesmo dia (decisão do dono)", () => {
  it("a manutenção da semana é a prevista mais perto, até 7 dias", () => {
    expect(manutencaoDaSemana(orto, "2026-11-18")).toBe("2026-11-20");
    expect(manutencaoDaSemana(orto, "2026-11-27")).toBe("2026-11-20");
    expect(manutencaoDaSemana(orto, "2026-12-05")).toBeNull();
  });
  it("sessão do plano com manutenção prevista na semana → prepara a manutenção com o ortodontista", () => {
    expect(emSeguida({ type: "treatment_session", date: "2026-11-19", orto, sessoesAAgendar: 0 })).toEqual({
      tipo: "ortho_maintenance",
      providerId: "orto-1",
      prevista: "2026-11-20",
    });
  });
  it("manutenção com sessão do plano a agendar → prepara a sessão", () => {
    expect(emSeguida({ type: "ortho_maintenance", date: "2026-11-19", orto, sessoesAAgendar: 2 })).toEqual({
      tipo: "treatment_session",
      providerId: null,
    });
  });
  it("sem caso, sem prevista na semana ou sem sessão a agendar → nada", () => {
    expect(emSeguida({ type: "treatment_session", date: "2026-11-19", orto: null, sessoesAAgendar: 3 })).toBeNull();
    expect(emSeguida({ type: "treatment_session", date: "2026-12-05", orto, sessoesAAgendar: 0 })).toBeNull();
    expect(emSeguida({ type: "ortho_maintenance", date: "2026-11-19", orto, sessoesAAgendar: 0 })).toBeNull();
    expect(emSeguida({ type: "evaluation", date: "2026-11-19", orto, sessoesAAgendar: 3 })).toBeNull();
  });
  it("o segundo começa quando o primeiro termina", () => {
    expect(horarioEmSeguida("14:00", 30)).toBe("14:30");
    expect(horarioEmSeguida("09:45", 60)).toBe("10:45");
    expect(horarioEmSeguida("23:30", 60)).toBeNull();
    expect(horarioEmSeguida("", 30)).toBeNull();
  });
});

describe("espelho do banco (migração 0425 — AP176)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0425_ortodontia_tipo_manutencao_ortodontica.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const sync = sql.slice(sql.indexOf("function public.ortho_appointment_sync("));

  it("o valor novo do enum, sem usá-lo antes do commit", () => {
    expect(sql).toContain("alter type public.appointment_type add value if not exists 'ortho_maintenance';");
    const semComentarios = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(semComentarios).not.toMatch(/'ortho_maintenance'::(public\.)?appointment_type/);
  });
  it("só o tipo próprio (e o início legado) cria manutenção; sessão e retorno não", () => {
    expect(sync).toContain("if new.type::text not in ('ortho_maintenance','treatment_start') then");
    expect(sync).not.toContain("'treatment_session','treatment_start','return_visit'");
    expect(sync).toContain("new.type::text = 'ortho_maintenance' and v_c.status not in ('em_tratamento','contencao')");
    expect(sync).toContain("new.type::text = 'treatment_start' and v_c.status <> 'aguardando_inicio'");
  });
  it("com o tipo próprio, a manutenção liga seja quem for que atenda", () => {
    expect(sync).toMatch(/if new\.type::text <> 'ortho_maintenance'\s+and v_c\.orthodontist_id is distinct from new\.provider_user_id then/);
  });
  it("a sessão de plano continua solta (o que a 0417 trouxe fica)", () => {
    expect(sync).toContain("if v_plan then");
    expect(sync).toContain("if v_link_only then return null; end if;");
  });
});
