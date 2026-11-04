import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mensagemDoConflito, numeroDoConflito } from "@/lib/signatures/duplicidade";
import { mensagemDaPorta } from "@/lib/signatures/send";

// AP108 (decisão do dono, 04/11/2026): "não pode ter o risco de assinar duas
// vezes o mesmo documento". Visto no teste real da ZS8: dois pacotes com o
// mesmo contrato abertos ao mesmo tempo (ASS-000049 e ASS-000050) — para a
// ZapSign são dois documentos, e assinar um não trava o outro.
//
// O banco recusa (0361): na criação (cada documento) e no envio (rascunho →
// enviado, com trava por parte para dois envios simultâneos). A tela explica
// antes e oferece "Cancelar o anterior e enviar este"; documento já ASSINADO
// só avisa e pede confirmação.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const migracoes = () =>
  readdirSync(join(RAIZ, "supabase", "migrations"))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => ler(`supabase/migrations/${f}`))
    .join("\n");

describe("o banco não deixa dois pacotes abertos com o mesmo documento (0361)", () => {
  const sql = migracoes();

  it("há gatilho na criação (itens) e no envio (pacote)", () => {
    expect(sql).toMatch(/create trigger signature_items_no_duplicate_open\s+before insert on public\.signature_package_items/);
    expect(sql).toMatch(/create trigger signature_packages_no_duplicate_open\s+before update of status on public\.signature_packages/);
  });

  it("os dois gatilhos usam a trava por parte (dois envios ao mesmo tempo)", () => {
    const corpos = [...sql.matchAll(/create or replace function public\.signature_(items|packages)_no_duplicate_open\(\)[\s\S]*?\$function\$;/g)].map((m) => m[0]);
    expect(corpos.length).toBeGreaterThanOrEqual(2);
    for (const c of corpos) expect(c).toContain("_signature_party_lock(");
  });

  it("só conta pacote AGUARDANDO; cancelado e assinado não bloqueiam", () => {
    const conflito = /create or replace function public\._signature_open_conflict[\s\S]*?\$function\$;/.exec(sql)?.[0] ?? "";
    expect(conflito).toContain("p.status in ('sent', 'partially_signed')");
  });
});

describe("a tela explica e oferece a saída", () => {
  it("a recusa do banco vira a mensagem com o número do pacote aberto", () => {
    expect(numeroDoConflito("OPEN_PACKAGE_EXISTS:ASS-000049")).toBe("ASS-000049");
    expect(numeroDoConflito("outra coisa")).toBeNull();
    expect(mensagemDaPorta('new row ... OPEN_PACKAGE_EXISTS:ASS-000049')).toBe(mensagemDoConflito("ASS-000049"));
  });

  it("a preparação confere antes de criar (paciente e empresa)", () => {
    for (const f of ["src/lib/signatures/send.ts", "src/lib/signatures/send-empresa.ts"]) {
      const s = ler(f);
      const confere = s.indexOf("pacoteAbertoComOsMesmos(");
      const cria = s.indexOf('rpc("signature_create_package"');
      expect(confere, f).toBeGreaterThan(0);
      expect(confere, `${f}: a conferência vem antes da criação`).toBeLessThan(cria);
      expect(s, f).toContain("pacoteAssinadoComOsMesmos(");
      expect(s, f).toContain("confirmouJaAssinado");
    }
  });

  it("o botão de preparar não passa o clique como 'já confirmei' (as duas janelas)", () => {
    for (const f of ["src/app/(app)/assinaturas/enviar-dialog.tsx", "src/app/(app)/assinaturas/enviar-empresa-dialog.tsx"]) {
      const s = ler(f);
      expect(s, f).not.toContain("onClick={preparar}");
      expect(s, f).toContain("<AvisoDeDuplicidade");
      expect(s, f).toContain("onEnviarMesmoAssim={() => preparar(true)}");
    }
  });

  it("o aviso cancela o anterior com o motivo da substituição", () => {
    const s = ler("src/app/(app)/assinaturas/aviso-de-duplicidade.tsx");
    expect(s).toContain("cancelarPacoteDeAssinatura(");
    expect(s).toContain("MOTIVO_DA_SUBSTITUICAO");
  });
});
