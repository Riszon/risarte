// Gera a migração 0308 (referência do odontograma + regras clínicas dos
// procedimentos) a partir dos JSON TUSS e das planilhas que o dono revisou
// (OD1, 19/10/2026). Rodar UMA vez; a migração gerada é o que vale — depois
// dela, quem muda é o Admin, pela tela Administração → Odontograma.
//
//   node scripts/odontograma-gerar-0308.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const XLSX = createRequire(import.meta.url)("xlsx");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAIZ = path.join(__dirname, "..");
const PLANILHAS = path.join(RAIZ, "..", "Odontograma - revisão OD1");
const SAIDA = path.join(RAIZ, "supabase", "migrations", "0308_odontograma_referencia_e_regras.sql");

const json = (f) => JSON.parse(fs.readFileSync(path.join(RAIZ, "docs/referencias/tuss", `${f}.json`), "utf8").replace(/^﻿/, ""));
const aba = (arq, nome) => XLSX.utils.sheet_to_json(XLSX.readFile(path.join(PLANILHAS, arq)).Sheets[nome], { defval: "" });
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (lista) => (lista.length ? `array[${lista.map(q).join(", ")}]::text[]` : "'{}'::text[]");

// --- dentes -------------------------------------------------------------------
const facesPlanilha = aba("2 - Faces por dente e dentes por região.xlsx", "Faces por dente");
const GRUPO = { Incisivo: "incisor", Canino: "canine", "Pré-molar": "premolar", Molar: "molar", "Molar decíduo": "deciduous_molar", Supranumerário: "supernumerary" };
const dentes = json("dentes").map((d) => {
  const n = Number(d.id);
  const quad = Math.floor(n / 10);
  const linha = facesPlanilha.find((r) => String(r["Dente (FDI)"]) === d.id);
  if (!linha) throw new Error("dente sem linha na planilha: " + d.id);
  const grupo = GRUPO[linha["Grupo"]];
  if (!grupo) throw new Error("grupo desconhecido: " + linha["Grupo"]);
  return {
    code: d.id, name: d.display_name.trim(),
    dentition: quad >= 5 ? "deciduous" : "permanent",
    arch: [1, 2, 5, 6].includes(quad) ? "upper" : "lower",
    quadrant: quad, position: n % 10, group: grupo,
    faces: String(linha["Faces"]).split(",").map((x) => x.trim()).filter(Boolean),
  };
});
if (dentes.length !== 60) throw new Error("esperava 60 dentes");

// --- faces e regiões ------------------------------------------------------------
const faces = json("faces_dentes");
const regioesPlanilha = aba("2 - Faces por dente e dentes por região.xlsx", "Dentes por região");
const regioes = json("regioes_boca").map((r) => {
  const linha = regioesPlanilha.find((x) => String(x["Região (TUSS 42)"]) === r.id);
  if (!linha) throw new Error("região sem linha na planilha: " + r.id);
  const dentesDaRegiao = String(linha["Dentes que a região seleciona"]) === "—"
    ? [] : String(linha["Dentes que a região seleciona"]).split(",").map((x) => x.trim());
  return { code: r.id, name: r.display_name.trim(), teeth: dentesDaRegiao };
});

// --- situações ----------------------------------------------------------------------
const ONDE = { Face: "face", "Coroa (dente)": "crown", Raiz: "root", "Dente inteiro": "whole_tooth", "Entre dentes": "between_teeth" };
const USO = { Achado: "finding", Efeito: "effect", "Os dois": "both" };
const situacoes = aba("1 - Situações do dente.xlsx", "Situações").map((r, i) => {
  const code = String(r["Código"]).trim();
  if (!ONDE[r["Onde se marca"]] || !USO[r["Usada como"]]) throw new Error("situação com campo desconhecido: " + code);
  return {
    code, name: String(r["Situação"]).trim(),
    source: String(r["Origem"]).startsWith("TUSS") ? "tuss" : "risarte",
    applies: ONDE[r["Onde se marca"]], usage: USO[r["Usada como"]],
    symbol: String(r["Símbolo proposto"]).trim(), sort: (i + 1) * 10,
  };
});
const codigosSituacao = new Set(situacoes.map((s) => s.code));

// --- regras dos procedimentos --------------------------------------------------------
const NIVEL = { Face: "face", Dente: "tooth", "Região": "region", Arcada: "arch", "Sem marcação no dente": "none" };
const DENT = { "Decídua": "deciduous", Permanente: "permanent", Ambas: "both" };
const FACE_NOME = { Vestibular: "V", Oclusal: "O" };
function gruposDe(txt) {
  if (txt.startsWith("Anteriores")) return ["incisor", "canine"];
  if (txt.startsWith("Posteriores")) return ["premolar", "molar", "deciduous_molar"];
  if (txt.startsWith("Unirradiculares")) return ["incisor", "canine", "premolar"];
  if (txt.startsWith("Birradiculares")) return ["premolar"];
  if (txt.startsWith("Multirradiculares")) return ["molar", "deciduous_molar"];
  return []; // Todos / —
}
function codigos(txt) {
  const achados = String(txt).match(/RZ-[A-Z]+|\b[HCRAE]\b/g) ?? [];
  for (const c of achados) if (!codigosSituacao.has(c)) throw new Error("situação inexistente na regra: " + c);
  return [...new Set(achados)];
}
const regras = aba("3 - Classificação dos procedimentos.xlsx", "Procedimentos").map((r) => {
  const nivel = NIVEL[r["Nível (sugerido)"]];
  if (!nivel) throw new Error("nível desconhecido: " + r["Nível (sugerido)"]);
  const f = String(r["Nº de faces"]);
  let fmin = null, fmax = null, fixas = [];
  if (nivel === "face") {
    const m = f.match(/^(\d)(?: a (\d))?/);
    if (!m) throw new Error("faces ilegíveis: " + f);
    fmin = Number(m[1]); fmax = Number(m[2] ?? m[1]);
    const nomeFixa = f.match(/\((\w+)\)/);
    if (nomeFixa) fixas = [FACE_NOME[nomeFixa[1]]];
  }
  const efeitos = codigos(r["Efeito depois de realizado"]);
  return {
    tuss: String(r["TUSS"]), nivel, fmin, fmax, fixas,
    dent: DENT[r["Dentição"]], grupos: gruposDe(String(r["Dentes compatíveis"])),
    impede: codigos(r["Situações que IMPEDEM"]), exige: codigos(r["Situação EXIGIDA"]),
    efeito: efeitos[0] ?? null, efeitoAusente: efeitos[1] ?? null,
    conf: { Alta: "high", "Média": "medium", Baixa: "low" }[r["Confiança da sugestão"]],
  };
});
if (regras.length !== 370) throw new Error("esperava 370 regras");

// --- SQL ------------------------------------------------------------------------------
const L = [];
L.push(fs.readFileSync(path.join(__dirname, "odontograma-0308-estrutura.sql"), "utf8").trimEnd());
L.push("", "-- =============================================================================",
  "-- SEMENTES (geradas por scripts/odontograma-gerar-0308.mjs a partir dos JSON TUSS",
  "-- e das planilhas revisadas pelo dono em 19/10/2026). on conflict = já existe.",
  "-- =============================================================================", "");
L.push("insert into public.dental_faces (code, name) values");
L.push(faces.map((f) => `  (${q(f.id)}, ${q(f.display_name.trim())})`).join(",\n") + "\non conflict (code) do nothing;", "");
L.push("insert into public.dental_teeth (code, name, dentition, arch, quadrant, position, tooth_group) values");
L.push(dentes.map((d) => `  (${q(d.code)}, ${q(d.name)}, ${q(d.dentition)}, ${q(d.arch)}, ${d.quadrant}, ${d.position}, ${q(d.group)})`).join(",\n") + "\non conflict (code) do nothing;", "");
L.push("insert into public.dental_tooth_faces (tooth_code, face_code) values");
L.push(dentes.flatMap((d) => d.faces.map((f) => `  (${q(d.code)}, ${q(f)})`)).join(",\n") + "\non conflict do nothing;", "");
L.push("insert into public.dental_regions (code, name) values");
L.push(regioes.map((r) => `  (${q(r.code)}, ${q(r.name)})`).join(",\n") + "\non conflict (code) do nothing;", "");
L.push("insert into public.dental_region_teeth (region_code, tooth_code) values");
L.push(regioes.flatMap((r) => r.teeth.map((t) => `  (${q(r.code)}, ${q(t)})`)).join(",\n") + "\non conflict do nothing;", "");
L.push("insert into public.dental_conditions (code, name, source, applies_to, usage, symbol, sort_order) values");
L.push(situacoes.map((s) => `  (${q(s.code)}, ${q(s.name)}, ${q(s.source)}, ${q(s.applies)}, ${q(s.usage)}, ${q(s.symbol)}, ${s.sort})`).join(",\n") + "\non conflict (code) do nothing;", "");
L.push("-- As regras entram pelo código TUSS: o procedimento de cada banco tem o seu id.");
L.push("insert into public.procedure_dental_rules (procedure_id, application_level, face_count_min, face_count_max, fixed_faces, dentition, tooth_groups, blocked_conditions, required_conditions, effect_condition, effect_when_absent, confidence)");
L.push("select p.id, v.nivel, v.fmin, v.fmax, v.fixas, v.dent, v.grupos, v.impede, v.exige, v.efeito, v.efeito_ausente, v.conf");
L.push("  from (values");
L.push(regras.map((r) => `    (${q(r.tuss)}, ${q(r.nivel)}, ${r.fmin ?? "null::smallint"}, ${r.fmax ?? "null::smallint"}, ${arr(r.fixas)}, ${q(r.dent)}, ${arr(r.grupos)}, ${arr(r.impede)}, ${arr(r.exige)}, ${q(r.efeito)}, ${q(r.efeitoAusente)}, ${q(r.conf)})`).join(",\n"));
L.push("  ) as v(tuss, nivel, fmin, fmax, fixas, dent, grupos, impede, exige, efeito, efeito_ausente, conf)");
L.push("  join public.procedures p on p.tuss_code = v.tuss");
L.push("on conflict (procedure_id) do nothing;", "");
L.push("-- As tabelas novas entram na auditoria (regra 7 do CLAUDE.md).");
L.push("select public.audit_attach_all();", "");
fs.writeFileSync(SAIDA, L.join("\n"));
console.log("gravada:", path.basename(SAIDA), "|", dentes.length, "dentes,", faces.length, "faces,", regioes.length, "regiões,",
  situacoes.length, "situações,", regras.length, "regras");
