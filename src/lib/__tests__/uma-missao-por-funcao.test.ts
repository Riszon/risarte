import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agruparMissoes, listaDeNomes } from "@/lib/certificacao-equipe";

// AP52 (achado no OC-00111, produção, 19/10/2026): uma dentista convocada
// como DENTISTA em duas turmas abertas (Cambé e Londrina). A certificação é
// por FUNÇÃO e a contagem não separa unidade — eram duas missões medindo o
// mesmo trabalho: dois quadros, dois certificados, e um "Aceitar" que sobrava.
// Decisão do dono: UMA missão vale para as duas unidades.

const RAIZ = join(__dirname, "..", "..", "..");
const MIGRACAO = readFileSync(join(RAIZ, "supabase/migrations/0305_uma_missao_por_funcao.sql"), "utf8");

const m = (role: string, status: string, started_at: string | null = null, kind = "novatos") => ({ role, kind, status, started_at });

describe("um quadro por função", () => {
  it("a mesma função em duas unidades vira UM grupo; funções diferentes ficam separadas", () => {
    const grupos = agruparMissoes([m("dentist", "convocado"), m("dentist", "em_andamento", "2026-10-19T10:00:00Z"), m("tsb", "convocado")]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.representante.role === "dentist")?.todas).toHaveLength(2);
  });

  it("a representante é a mais adiantada — é ela que se mede e se registra", () => {
    const [g] = agruparMissoes([m("dentist", "convocado"), m("dentist", "concluido", "2026-10-19T10:00:00Z"), m("dentist", "em_andamento", "2026-10-18T10:00:00Z")]);
    expect(g.representante.status).toBe("concluido");
    const [h] = agruparMissoes([m("dentist", "convocado"), m("dentist", "em_andamento", "2026-10-19T10:00:00Z")]);
    expect(h.representante.status).toBe("em_andamento");
  });

  it("novatos e reciclagem da mesma função não se misturam", () => {
    expect(agruparMissoes([m("dentist", "convocado", null, "novatos"), m("dentist", "convocado", null, "reciclagem")])).toHaveLength(2);
  });

  it("as unidades no título", () => {
    expect(listaDeNomes(["Cambé"])).toBe("Cambé");
    expect(listaDeNomes(["Cambé", "Londrina"])).toBe("Cambé e Londrina");
    expect(listaDeNomes(["Cambé", "Londrina", "Maringá", "Cambé"])).toBe("Cambé, Londrina e Maringá");
  });
});

describe("o banco anda com as irmãs juntas (0305)", () => {
  it("irmã = mesma pessoa, mesma função, mesmo tipo, turma aberta — e nunca volta atrás", () => {
    expect(MIGRACAO).toMatch(/and tc\.status = 'aberta'\s+and tc\.kind = e\.kind\s+and s\.user_id = e\.user_id\s+and s\.role = e\.role\s+and s\.id <> e\.id\s+and s\.status <> 'dispensado'/);
    expect(MIGRACAO).toContain("-- Nunca volta atrás: concluída não reabre, em andamento não volta a convocada.");
  });

  it("aceitar usa o marco da irmã que já começou — o trabalho feito não se perde", () => {
    expect(MIGRACAO).toContain("set started_at = coalesce(v_marco_irma, now()), status = 'em_andamento'");
    expect(MIGRACAO).toContain("if v_user is distinct from auth.uid() then");
  });

  it("o certificado sai UMA vez", () => {
    expect(MIGRACAO).toMatch(/if not exists \(\s+select 1 from public\.training_certifications c\s+where c\.user_id = e\.user_id and c\.role = e\.role\s+and c\.certified_at >= e\.invited_at\s+\) then\s+insert into public\.training_certifications/);
  });

  it("cumprir e aprovar levam as irmãs junto", () => {
    const certificar = MIGRACAO.slice(MIGRACAO.indexOf("function public._certify_enrollment("));
    expect(certificar).toContain("perform public._sync_training_siblings(p_enrollment_id);");
    const registrar = MIGRACAO.slice(MIGRACAO.indexOf("function public.record_training_completion("));
    expect(registrar).toMatch(/set approval_status = 'pendente'\s+where id = p_enrollment_id;\s+-- AP52[^\n]*\n\s+perform public\._sync_training_siblings\(p_enrollment_id\);/);
  });

  it("as portas continuam fechadas", () => {
    expect(MIGRACAO).toContain("revoke execute on function public._sync_training_siblings(uuid) from public, anon, authenticated;");
    expect(MIGRACAO).toContain("grant execute on function public.record_training_completion(uuid, jsonb) to service_role;");
  });
});
