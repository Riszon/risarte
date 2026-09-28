import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { decidirEnvio } from "@/lib/gravacao";

// OC-00085 + OC-00086 (27/09/2026): o fim da avaliação tem UMA porta, e o
// áudio vai junto com ela.

describe("o áudio antes do envio (OC-00086)", () => {
  it("salvo ou nada gravado: envia sem dizer nada", () => {
    expect(decidirEnvio("salvo")).toBeNull();
    expect(decidirEnvio("nada")).toBeNull();
  });
  it("áudio que FALHOU bloqueia o envio — quem avalia precisa saber antes", () => {
    expect(decidirEnvio("falhou")?.bloqueia).toBe(true);
  });
  it("áudio ainda subindo não segura o envio, mas avisa", () => {
    const d = decidirEnvio("demorou");
    expect(d?.bloqueia).toBe(false);
    expect(d?.aviso).toMatch(/sendo salvo/);
  });
});

// ⚠️ A RÉGUA: todo lugar que envia a avaliação ao Planejamento ou conclui a
// reavaliação tem de parar (e esperar) a gravação ANTES. Botão novo de envio
// sem isso volta a deixar o áudio gravando depois do envio — o OC-00086.
function arquivosTsx(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivosTsx(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("quem envia a avaliação para a gravação antes (OC-00086)", () => {
  const telas = arquivosTsx(join(process.cwd(), "src/app")).filter((p) => {
    const t = readFileSync(p, "utf8");
    return /\bsendToPlanningCenter\(|\bconcluirReavaliacao\(/.test(t);
  });

  it("acha as telas que enviam (régua que não acha nada grita)", () => {
    expect(telas.length).toBeGreaterThanOrEqual(2);
  });

  for (const p of telas) {
    it(`${p.split(/[\\/]/).slice(-2).join("/")} para a gravação antes de enviar`, () => {
      const t = readFileSync(p, "utf8");
      const chamadas = [...t.matchAll(/\b(sendToPlanningCenter|concluirReavaliacao)\(/g)];
      for (const m of chamadas) {
        const antes = t.slice(Math.max(0, m.index! - 700), m.index!);
        expect(antes).toMatch(/pararGravacaoDoCliente\(/);
      }
    });
  }
});

describe("avaliação não se conclui no painel (OC-00085)", () => {
  it("o painel desvia avaliação/reavaliação para 'Abrir avaliação' antes do Concluir", () => {
    const t = readFileSync(
      join(process.cwd(), "src/app/(app)/atendimento/attendance-panel.tsx"),
      "utf8"
    );
    const desvio = t.indexOf("Abrir avaliação");
    const concluir = t.indexOf('() => updateAttendance(a.id, "done")');
    expect(desvio).toBeGreaterThan(-1);
    expect(concluir).toBeGreaterThan(desvio);
    expect(t).toContain("Encerrar sem enviar");
  });
});
