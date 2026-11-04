import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Relato do André (RIS-000003, 04/11/2026): "escrevi um monte, deu erro para
// tentar mais tarde e perdi tudo". Duas causas:
//
// 1. Com `<form action={fn}>` o React 19 LIMPA os campos ao fim do envio —
//    também quando o servidor recusa. Os formulários de relato usam
//    `onSubmit` e limpam só no sucesso.
// 2. O Financeiro da Franqueadora tem no seletor unidades SEM função nelas
//    (OC-00120); a regra de inclusão de `system_reports` recusava (42501).
//    O relato cai na unidade da ficha.

const PASTA = join(__dirname, "..", "..", "app", "(app)", "problemas");
const ler = (...p: string[]) => readFileSync(join(PASTA, ...p), "utf8");

const FORMULARIOS = {
  "formulario.tsx": ler("formulario.tsx"),
  "[codigo]/conversa.tsx": ler("[codigo]", "conversa.tsx"),
};

describe("o relato não perde o que a pessoa escreveu", () => {
  for (const [nome, texto] of Object.entries(FORMULARIOS)) {
    it(`${nome}: nenhum <form action=…> (o React limparia no erro)`, () => {
      const forms = texto.match(/<form[\s\S]*?>/g) ?? [];
      // Régua que não acha formulário nenhum não mediu nada.
      expect(forms.length).toBeGreaterThan(0);
      for (const f of forms) {
        expect(f).not.toMatch(/\baction=\{/);
        expect(f).toMatch(/onSubmit=\{/);
      }
    });
  }

  it("o envio do relato só limpa os campos no sucesso", () => {
    const f = FORMULARIOS["formulario.tsx"];
    const sucesso = f.indexOf("if (r.ok && r.code)");
    const falha = f.indexOf("} else {", sucesso);
    expect(sucesso).toBeGreaterThan(0);
    expect(f.indexOf("formRef.current?.reset()")).toBeGreaterThan(sucesso);
    expect(f.indexOf("formRef.current?.reset()")).toBeLessThan(falha);
  });
});

describe("unidade sem função não trava o relato", () => {
  it("o servidor troca a unidade ativa sem função pela da ficha", () => {
    const a = ler("actions.ts");
    const inicio = a.indexOf("export async function registrarProblema");
    const corpo = a.slice(inicio, a.indexOf("export async function", inicio + 10));
    expect(corpo).toMatch(
      /if \(clinicId && !session\.isAdminMaster && !\(session\.rolesByClinic\[clinicId\]\?\.length\)\) \{\s*clinicId = null;/
    );
    // E a troca vem ANTES de procurar a unidade da ficha.
    expect(corpo.indexOf("clinicId = null;")).toBeLessThan(corpo.indexOf('rpc("my_report_clinic")'));
  });
});
