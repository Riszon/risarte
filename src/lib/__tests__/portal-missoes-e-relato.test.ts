import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { caminhoDoPortal } from "@/lib/auth";

// Relato OC-00111 (produção, 19/10/2026), quem ainda está no modo portal:
// "não consigo selecionar a unidade para aceitar a certificação" e "não
// consigo relatar o problema na própria tela". Os dois eram defeito:
//   1. o Início buscava UMA missão (`.limit(1)`) — quem tinha TSB em Cambé e
//      ASB em Londrina só via a mais recente, e a outra não tinha como aceitar;
//   2. a boia do portal nascia sem unidade e o banco recusava o relato da
//      unidade fechada (a tranca da 0277 a esconde de `user_clinic_ids`).
// Decisões do dono: um quadro por missão; relato na unidade da FICHA; e o
// SINO também no portal (é por ele que chega a convocação, 0303).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const MIGRACAO = ler("supabase/migrations/0304_relatar_no_portal.sql");

describe("todas as missões, uma por quadro", () => {
  const dados = ler("src/app/(app)/inicio-dados.ts");
  const corpo = dados.slice(dados.indexOf("export async function missoesAbertas("), dados.indexOf("export async function missoesAbertas(") + 6000);

  it("lê TODAS as matrículas abertas — sem `.limit(1)`, sem `.maybeSingle()`", () => {
    // Só a CONSULTA (o comentário acima dela cita o `.limit(1)` antigo).
    const consulta = corpo.slice(corpo.indexOf(".from(\"training_enrollments\")"), corpo.indexOf("if (error || !data"));
    expect(consulta).toContain('.from("training_enrollments")');
    expect(consulta).not.toContain(".limit(1)");
    expect(consulta).not.toContain(".maybeSingle()");
  });

  it("cada quadro diz a UNIDADE e o Início desenha um por missão", () => {
    expect(corpo).toContain("unidade: d.clinic_id ? (nomeDaUnidade.get(String(d.clinic_id)) ?? null) : null,");
    // Nos DOIS estados do quadro: a missão em andamento e a cumprida.
    expect(ler("src/components/missao-de-certificacao.tsx").split("{missao.unidade && ` · Unidade: ${missao.unidade}`}").length - 1).toBe(2);
    expect(ler("src/app/(app)/page.tsx")).toMatch(/\{minhasMissoes\.map\(\(m\) => \(\s+<MissaoDeCertificacao key=\{m\.id\} missao=\{m\} \/>/);
  });

  it("cada missão é medida e registrada por conta própria", () => {
    expect(corpo).toMatch(/for \(const d of data\) \{[\s\S]*await guardarProgresso\(String\(d\.id\), medicao\);\s+const registrado = await registrarSeCumprida\(String\(d\.id\), medicao\);/);
  });
});

describe("relatar no modo portal", () => {
  it("a boia do portal deixa registrar (a unidade vem da ficha)", () => {
    const barra = ler("src/components/topbar.tsx");
    expect(barra).toContain("{modoPortal && <ReportNavItem temUnidade isAdminMaster={false} />}");
    expect(barra).not.toContain("<ReportNavItem temUnidade={false}");
  });

  it("o servidor pega a unidade da ficha pelo banco, que enxerga a unidade fechada", () => {
    const acao = ler("src/app/(app)/problemas/actions.ts");
    expect(acao).toContain('.rpc("my_report_clinic")');
    expect(acao).toContain("session.rolesByClinic[clinicId] ?? papeisDaFicha ?? []");
  });

  it("o banco aceita a unidade da ficha — só em nome da própria pessoa", () => {
    expect(MIGRACAO).toContain("from public.user_clinic_roles_all r, eu");
    expect(MIGRACAO).toMatch(/with check \(\s+reporter_id = \(select auth\.uid\(\)\)\s+and \(/);
    expect(MIGRACAO).toContain("or clinic_id in (select m.clinic_id from public.my_report_clinic() m)");
    expect(MIGRACAO).toContain("revoke execute on function public.my_report_clinic() from public, anon, authenticated;");
  });
});

describe("o sino no modo portal", () => {
  it("aparece na barra e a tela de avisos abre no portal", () => {
    const barra = ler("src/components/topbar.tsx");
    expect(barra).not.toMatch(/\{!modoPortal && \(\s+<>\s+<ChatNavItem \/>\s+<NotificationNavItem \/>/);
    expect(barra).toMatch(/\{!modoPortal && <ChatNavItem \/>\}[\s\S]*?<NotificationNavItem \/>/);
    expect(caminhoDoPortal("/notificacoes")).toBe(true);
  });

  it("o resto continua fechado no portal", () => {
    expect(caminhoDoPortal("/agenda")).toBe(false);
    expect(caminhoDoPortal("/financeiro")).toBe(false);
  });
});
