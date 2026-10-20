import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Odontograma, type OdontogramaProps } from "@/components/odontograma/odontograma";
import {
  anosCompletos,
  corDaMarca,
  denticaoPelaIdade,
  descricaoDoDente,
  ehAnterior,
  ehSuperior,
  faceDoLado,
  fileiras,
} from "@/lib/odontograma/desenho";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("odontograma — a ordem dos dentes (FDI, vista de frente)", () => {
  it("permanente: 18→11 | 21→28 em cima, 48→41 | 31→38 embaixo", () => {
    const [sup, inf] = fileiras("permanente");
    expect(sup.dentes).toEqual(["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"]);
    expect(inf.dentes).toEqual(["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"]);
  });

  it("decídua: 55→51 | 61→65 e 85→81 | 71→75", () => {
    const [sup, inf] = fileiras("decidua");
    expect(sup.dentes).toEqual(["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"]);
    expect(inf.dentes).toEqual(["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"]);
  });

  it("mista mostra as quatro fileiras, decíduas por dentro", () => {
    const f = fileiras("mista");
    expect(f.map((x) => `${x.arcada}/${x.denticao}`)).toEqual([
      "superior/permanente",
      "superior/decidua",
      "inferior/decidua",
      "inferior/permanente",
    ]);
    // 52 dentes, nenhum repetido e nenhum supranumerário (x9)
    const todos = f.flatMap((x) => x.dentes);
    expect(todos).toHaveLength(52);
    expect(new Set(todos).size).toBe(52);
    expect(todos.some((d) => d.endsWith("9"))).toBe(false);
  });
});

describe("odontograma — que face fica em cada lado da coroa", () => {
  it("de cima: topo = V, base = P; de baixo: topo = L, base = V", () => {
    expect(faceDoLado("16", "topo")).toBe("V");
    expect(faceDoLado("16", "base")).toBe("P");
    expect(faceDoLado("36", "topo")).toBe("L");
    expect(faceDoLado("36", "base")).toBe("V");
    expect(faceDoLado("55", "base")).toBe("P");
    expect(faceDoLado("75", "topo")).toBe("L");
  });

  it("a MESIAL fica do lado do meio da boca, nos quatro quadrantes", () => {
    // Lado direito do paciente (à esquerda da tela): o meio está à direita.
    for (const d of ["11", "16", "41", "46", "51", "85"]) {
      expect(faceDoLado(d, "direita")).toBe("M");
      expect(faceDoLado(d, "esquerda")).toBe("D");
    }
    for (const d of ["21", "26", "31", "36", "61", "75"]) {
      expect(faceDoLado(d, "esquerda")).toBe("M");
      expect(faceDoLado(d, "direita")).toBe("D");
    }
  });

  it("centro: Incisal no anterior (1 a 3), Oclusal no posterior", () => {
    expect(faceDoLado("11", "centro")).toBe("I");
    expect(faceDoLado("13", "centro")).toBe("I");
    expect(faceDoLado("53", "centro")).toBe("I");
    expect(faceDoLado("14", "centro")).toBe("O");
    expect(faceDoLado("54", "centro")).toBe("O");
    expect(ehAnterior("43")).toBe(true);
    expect(ehAnterior("44")).toBe(false);
    expect(ehSuperior("65")).toBe(true);
    expect(ehSuperior("85")).toBe(false);
  });

  it("as faces do desenho batem com as faces de cada dente na referência (0308)", () => {
    // A referência que vale é a do banco (dental_tooth_faces, semeada pela
    // 0308): para cada dente desenhado, o que o desenho põe nos 5 lados
    // tem de estar entre as faces que a 0308 deu a ele.
    const sql = ler("supabase/migrations/0308_odontograma_referencia_e_regras.sql");
    const inicio = sql.indexOf("insert into public.dental_tooth_faces (tooth_code, face_code) values");
    expect(inicio).toBeGreaterThan(0);
    const bloco = sql.slice(inicio, sql.indexOf(";", inicio));
    const faces = new Map<string, Set<string>>();
    for (const m of bloco.matchAll(/\('([1-8][1-9])', '([A-Z])'\)/g)) {
      if (!faces.has(m[1])) faces.set(m[1], new Set());
      faces.get(m[1])!.add(m[2]);
    }
    expect(faces.size).toBeGreaterThanOrEqual(52); // a régua achou o que medir
    for (const d of fileiras("mista").flatMap((x) => x.dentes)) {
      for (const lado of ["topo", "base", "esquerda", "direita", "centro"] as const) {
        expect(faces.get(d)?.has(faceDoLado(d, lado)), `${d} ${lado}`).toBe(true);
      }
    }
  });
});

describe("odontograma — dentição pela idade", () => {
  it("até 5 decídua, 6 a 12 mista, depois permanente; sem data, permanente", () => {
    expect(denticaoPelaIdade(3)).toBe("decidua");
    expect(denticaoPelaIdade(5)).toBe("decidua");
    expect(denticaoPelaIdade(6)).toBe("mista");
    expect(denticaoPelaIdade(12)).toBe("mista");
    expect(denticaoPelaIdade(13)).toBe("permanente");
    expect(denticaoPelaIdade(null)).toBe("permanente");
    expect(denticaoPelaIdade(-1)).toBe("permanente");
  });

  it("anos completos pela data civil (aniversário ainda não chegou = um a menos)", () => {
    expect(anosCompletos("2018-10-20", "2026-10-20")).toBe(8);
    expect(anosCompletos("2018-10-21", "2026-10-20")).toBe(7);
    expect(anosCompletos("2018-11-01", "2026-10-20")).toBe(7);
    expect(anosCompletos(null, "2026-10-20")).toBeNull();
    expect(anosCompletos("lixo", "2026-10-20")).toBeNull();
  });
});

describe("odontograma — cor e leitura das marcas (D12)", () => {
  it("vermelho = a realizar, azul = existente, cinza = ausente; sugestão tracejada", () => {
    expect(corDaMarca({ situacao: "planejado", codigo: "C" })).toEqual({ classe: "planejado", tracejado: false });
    expect(corDaMarca({ situacao: "existente", codigo: "R" })).toEqual({ classe: "existente", tracejado: false });
    expect(corDaMarca({ situacao: "existente", codigo: "A" })).toEqual({ classe: "ausente", tracejado: false });
    expect(corDaMarca({ situacao: "sugerido", codigo: "C" })).toEqual({ classe: "existente", tracejado: true });
    // a realizar continua vermelho mesmo sendo extração de um dente que vai faltar
    expect(corDaMarca({ situacao: "planejado", codigo: "A" }).classe).toBe("planejado");
  });

  it("o leitor de tela diz o dente, o nome e cada marca", () => {
    expect(descricaoDoDente("16", "Primeiro molar superior direito", [])).toBe(
      "Dente 16, Primeiro molar superior direito: sem registro"
    );
    expect(
      descricaoDoDente("16", "Primeiro molar superior direito", [
        { dente: "16", faces: ["O", "M"], local: "face", situacao: "planejado", codigo: "C", simbolo: "C", nome: "Cariado" },
        { dente: "17", faces: [], local: "whole_tooth", situacao: "existente", codigo: "A", simbolo: "A", nome: "Ausente" },
      ])
    ).toBe("Dente 16, Primeiro molar superior direito: Cariado (faces O, M), a realizar");
  });
});

describe("odontograma — o componente desenha as marcas", () => {
  const faces = Object.fromEntries(
    fileiras("mista").flatMap((f) => f.dentes).map((d) => [d, ["V", "P", "L", "M", "D", "O", "I"]])
  );
  const desenhar = (props: Partial<OdontogramaProps>) =>
    renderToStaticMarkup(
      createElement(Odontograma, { modo: "leitura", denticaoInicial: "permanente", nomes: {}, faces, ...props })
    );

  it("face a realizar pinta de vermelho só a face marcada; sugestão é tracejada; ausente leva o X", () => {
    const html = desenhar({
      marcas: [
        { dente: "16", faces: ["O"], local: "face", situacao: "planejado", codigo: "C", simbolo: "C", nome: "Cariado" },
        { dente: "26", faces: ["M"], local: "face", situacao: "sugerido", codigo: "C", simbolo: "C", nome: "Cariado" },
        { dente: "36", faces: [], local: "whole_tooth", situacao: "existente", codigo: "A", simbolo: "A", nome: "Ausente" },
      ],
    });
    // (a legenda também tem amostra vermelha — conta só as faces do desenho)
    expect(html.match(/<polygon[^>]*fill-red-500\/80/g)).toHaveLength(1);
    expect(html).toMatch(/<polygon[^>]*data-face="O"[^>]*fill-red-500\/80/);
    expect(html).toMatch(/data-face="M"[^>]*stroke-dasharray="3 2"|stroke-dasharray="3 2"[^>]*data-face="M"/);
    expect(html.match(/<line /g)!.length).toBe(2 + 2); // as duas guias + o X do 36
    expect(html).toContain("Dente 16");
  });

  it("a miniatura não tem números nem legenda", () => {
    const html = desenhar({ modo: "compact" });
    expect(html).not.toContain(">18<");
    expect(html).not.toContain("Como ler o desenho");
    expect(desenhar({})).toContain(">18<");
  });
});

describe("odontograma — na ficha", () => {
  const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");

  it("a aba vem entre Clínico e Desenvolvimento", () => {
    const clinico = ficha.indexOf('<TabPanel id="clinico"');
    const odonto = ficha.indexOf('<TabPanel id="odontograma"');
    const desenv = ficha.indexOf('<TabPanel id="desenvolvimento"');
    expect(clinico).toBeGreaterThan(0);
    expect(odonto).toBeGreaterThan(clinico);
    expect(desenv).toBeGreaterThan(odonto);
  });

  it("quem vê: o clínico e quem apresenta — nunca o Assistente comercial (D8)", () => {
    expect(ficha).toContain("const canViewOdontograma = canViewAnamnesis || canPresent;");
    // as duas réguas que compõem a de cima não incluem o Assistente
    const regras = ficha.slice(ficha.indexOf("const canEditClinical"), ficha.indexOf("const canViewOdontograma"));
    expect(regras).not.toContain("commercial_assistant");
    expect(ficha).toContain("{canViewOdontograma && (\n          <TabPanel id=\"odontograma\"");
  });

  it("leitura que falha não vira desenho vazio", () => {
    expect(ficha).toContain("if (dentesR.error || facesR.error || (dentesR.data ?? []).length === 0) {");
    expect(ficha).toContain("odontogramaErro = true;");
  });
});
