// OD1 — as três planilhas para o dono revisar (D1, D2, D11). Nada é gravado
// no banco: lê os JSON TUSS e o catálogo da PRODUÇÃO (só leitura).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const RAIZ = "C:/Users/Administrador/Risarte riSZon/risarte";
const exigir = createRequire(RAIZ + "/package.json");
const XLSX = exigir("xlsx");
const { createClient } = exigir("@supabase/supabase-js");
const SAIDA = "C:/Users/Administrador/Risarte riSZon/Odontograma - revisão OD1";
fs.mkdirSync(SAIDA, { recursive: true });

const json = (f) => JSON.parse(fs.readFileSync(`${RAIZ}/docs/referencias/tuss/${f}.json`, "utf8").replace(/^\uFEFF/, ""));
const DENTES = json("dentes");
const FACES = json("faces_dentes");
const REGIOES = json("regioes_boca");
const SITUACOES_TUSS = json("situacao_inicial");

function salvar(nome, abas) {
  const wb = XLSX.utils.book_new();
  for (const [titulo, linhas, larguras] of abas) {
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    ws["!cols"] = larguras.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, titulo);
  }
  const arq = path.join(SAIDA, nome);
  XLSX.writeFile(wb, arq);
  console.log("gravado:", nome);
}

// =============================================================================
// 1) SITUAÇÕES (D1)
// =============================================================================
// Onde se marca: Face | Coroa (dente) | Raiz | Dente inteiro | Entre dentes
// Uso: Achado (diagnóstico) | Efeito (procedimento realizado) | Os dois
const RISARTE = [
  ["RZ-RESTPROV", "Restauração provisória", "Face", "Os dois", "RP"],
  ["RZ-RESTINS", "Restauração insatisfatória (a refazer)", "Face", "Achado", "RI"],
  ["RZ-CARINC", "Cárie incipiente / mancha branca", "Face", "Achado", "MB"],
  ["RZ-NCC", "Lesão cervical não cariosa (abfração / erosão)", "Face", "Achado", "LC"],
  ["RZ-DESGASTE", "Desgaste dental (atrição / erosão)", "Face", "Achado", "DG"],
  ["RZ-HIPOPLASIA", "Hipoplasia / fluorose", "Face", "Achado", "HP"],
  ["RZ-FRATURA", "Fratura", "Dente inteiro", "Achado", "FR"],
  ["RZ-SELANTE", "Selante", "Face", "Os dois", "SE"],
  ["RZ-FACETA", "Faceta", "Face", "Os dois", "FC"],
  ["RZ-ENDO", "Tratamento endodôntico (canal tratado)", "Raiz", "Os dois", "TC"],
  ["RZ-ENDOINS", "Endodontia insatisfatória / lesão periapical", "Raiz", "Achado", "LP"],
  ["RZ-NUCLEO", "Núcleo / pino", "Raiz", "Os dois", "NU"],
  ["RZ-COROA", "Coroa definitiva", "Coroa (dente)", "Os dois", "CO"],
  ["RZ-COROAPROV", "Coroa provisória", "Coroa (dente)", "Os dois", "CP"],
  ["RZ-IMPLANTE", "Implante", "Raiz", "Os dois", "IM"],
  ["RZ-COROAIMP", "Coroa sobre implante", "Coroa (dente)", "Os dois", "CI"],
  ["RZ-PFPILAR", "Prótese fixa — pilar", "Coroa (dente)", "Os dois", "PF"],
  ["RZ-PFPONTICO", "Prótese fixa — pôntico (elemento suspenso)", "Dente inteiro", "Os dois", "PO"],
  ["RZ-PPR", "Prótese parcial removível (dente reposto)", "Dente inteiro", "Os dois", "PR"],
  ["RZ-PT", "Prótese total (dente reposto)", "Dente inteiro", "Os dois", "PT"],
  ["RZ-RAIZRES", "Raiz residual", "Dente inteiro", "Achado", "RR"],
  ["RZ-INCLUSO", "Incluso / impactado", "Dente inteiro", "Achado", "IN"],
  ["RZ-SEMIINC", "Semi-incluso", "Dente inteiro", "Achado", "SI"],
  ["RZ-ERUPCAO", "Em erupção / não erupcionado", "Dente inteiro", "Achado", "ER"],
  ["RZ-ESFOLIADO", "Decíduo esfoliado (ausência natural)", "Dente inteiro", "Achado", "ES"],
  ["RZ-MOBILIDADE", "Mobilidade", "Dente inteiro", "Achado", "MO"],
  ["RZ-RECESSAO", "Recessão gengival", "Face", "Achado", "RG"],
  ["RZ-BOLSA", "Bolsa periodontal", "Dente inteiro", "Achado", "BP"],
  ["RZ-FURCA", "Lesão de furca", "Dente inteiro", "Achado", "LF"],
  ["RZ-APARELHO", "Aparelho ortodôntico (bráquete / banda)", "Coroa (dente)", "Os dois", "AO"],
  ["RZ-CONTENCAO", "Contenção ortodôntica", "Entre dentes", "Os dois", "CT"],
  ["RZ-GIROVERSAO", "Giroversão / dente mal posicionado", "Dente inteiro", "Achado", "GV"],
  ["RZ-DIASTEMA", "Diastema", "Entre dentes", "Achado", "DI"],
];
const ONDE_TUSS = { H: "Dente inteiro", C: "Face", R: "Face", A: "Dente inteiro", E: "Dente inteiro" };
const USO_TUSS = { H: "Achado", C: "Achado", R: "Os dois", A: "Os dois", E: "Achado" };
salvar("1 - Situações do dente.xlsx", [
  ["Situações", [
    ["Código", "Situação", "Origem", "Onde se marca", "Usada como", "Símbolo proposto", "Decisão (Sim / Não / Ajustar)", "Observação"],
    ...SITUACOES_TUSS.map((s) => [s.id, s.display_name, "TUSS 44 (oficial)", ONDE_TUSS[s.id], USO_TUSS[s.id], s.id, "— (oficial, não precisa aprovar)", ""]),
    ...RISARTE.map(([c, n, onde, uso, sim]) => [c, n, "Risarte (NÃO é TUSS)", onde, uso, sim, "", ""]),
  ], [14, 46, 22, 16, 12, 10, 30, 40]],
  ["Como revisar", [
    ["SITUAÇÕES DO DENTE — o que revisar"],
    [""],
    ["As 5 primeiras são da TUSS (tabela 44) e não mudam."],
    ["As demais são uma proposta da Risarte, porque a TUSS não tem canal, coroa, implante, prótese etc. — e o odontograma precisa delas para mostrar o que já foi feito."],
    [""],
    ["Coluna", "O que significa"],
    ["Onde se marca", "Face = numa face do dente (M, D, V, O/I, P/L). Coroa = a parte de cima do dente. Raiz = a raiz (canal, implante, pino). Dente inteiro = o dente todo. Entre dentes = espaço entre dois dentes."],
    ["Usada como", "Achado = o que o dentista ENCONTRA no exame. Efeito = o que o dente passa a ter DEPOIS de um procedimento. Os dois = serve para os dois casos."],
    ["Símbolo proposto", "Duas letras que aparecem no desenho junto da cor (a cor nunca é a única informação)."],
    ["Decisão", "Sim = entra como está. Não = sai. Ajustar = escreva na Observação o que mudar (nome, onde se marca, símbolo)."],
    [""],
    ["Pode ACRESCENTAR linhas no fim, com um código novo começando por RZ-."],
  ], [22, 120]],
]);

// =============================================================================
// 2) FACES POR DENTE e DENTES POR REGIÃO (D2)
// =============================================================================
const num = (id) => Number(id);
const quadrante = (id) => Math.floor(num(id) / 10);
const posicao = (id) => num(id) % 10;
const decíduo = (id) => quadrante(id) >= 5;
const superior = (id) => [1, 2, 5, 6].includes(quadrante(id));
const supranumerario = (id) => posicao(id) === 9;
function grupo(id) {
  if (supranumerario(id)) return "Supranumerário";
  const p = posicao(id);
  if (p <= 2) return "Incisivo";
  if (p === 3) return "Canino";
  if (decíduo(id)) return "Molar decíduo";
  return p <= 5 ? "Pré-molar" : "Molar";
}
const anterior = (id) => ["Incisivo", "Canino"].includes(grupo(id));
const nomeFace = Object.fromEntries(FACES.map((f) => [f.id, f.display_name]));
function faces(id) {
  if (supranumerario(id)) return { lista: ["V", "M", "D", "O", "I", superior(id) ? "P" : "L"], nota: "Posição varia: todas as faces liberadas — conferir" };
  return { lista: ["V", "M", "D", anterior(id) ? "I" : "O", superior(id) ? "P" : "L"], nota: "" };
}
const linhasFaces = DENTES.slice()
  .sort((a, b) => num(a.id) - num(b.id))
  .map((d) => {
    const f = faces(d.id);
    return [d.id, d.display_name, decíduo(d.id) ? "Decídua" : "Permanente", superior(d.id) ? "Superior" : "Inferior", grupo(d.id),
      f.lista.join(", "), f.lista.map((x) => nomeFace[x]).join(", "), f.nota, "", ""];
  });

// Regiões: só as que têm dentes recebem lista; as de tecido/osso ficam sem.
const faixa = (q, de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => String(q * 10 + de + i));
const R = {
  AS: [...faixa(1, 1, 9), ...faixa(2, 1, 9), ...faixa(5, 1, 5), "59", ...faixa(6, 1, 5), "69"],
  AI: [...faixa(3, 1, 9), ...faixa(4, 1, 9), ...faixa(7, 1, 5), "79", ...faixa(8, 1, 5), "89"],
  HASD: [...faixa(1, 1, 9), ...faixa(5, 1, 5), "59"],
  HASE: [...faixa(2, 1, 9), ...faixa(6, 1, 5), "69"],
  HAIE: [...faixa(3, 1, 9), ...faixa(7, 1, 5), "79"],
  HAID: [...faixa(4, 1, 9), ...faixa(8, 1, 5), "89"],
  S1: [...faixa(1, 4, 8), "54", "55"],
  S2: ["13", "12", "11", "21", "22", "23", "53", "52", "51", "61", "62", "63"],
  S3: [...faixa(2, 4, 8), "64", "65"],
  S4: [...faixa(3, 4, 8), "74", "75"],
  S5: ["33", "32", "31", "41", "42", "43", "73", "72", "71", "81", "82", "83"],
  S6: [...faixa(4, 4, 8), "84", "85"],
  RIS: ["11", "21", "51", "61"],
  RII: ["31", "32", "41", "42", "71", "72", "81", "82"],
  RCSD: ["12", "13", "52", "53"],
  RCSE: ["22", "23", "62", "63"],
  RCID: ["43", "83"],
  RCIE: ["33", "73"],
  RMD: ["16", "17", "18", "46", "47", "48", "54", "55", "84", "85"],
  RME: ["26", "27", "28", "36", "37", "38", "64", "65", "74", "75"],
  RMSD: ["16", "17", "18", "54", "55"],
  RMSE: ["26", "27", "28", "64", "65"],
  RMID: ["46", "47", "48", "84", "85"],
  RMIE: ["36", "37", "38", "74", "75"],
  RPD: ["14", "15", "44", "45"],
  RPE: ["24", "25", "34", "35"],
  RPSD: ["14", "15"],
  RPSE: ["24", "25"],
  RPID: ["44", "45"],
  RPIE: ["34", "35"],
  RMPD: [...faixa(1, 4, 8), ...faixa(4, 4, 8), "54", "55", "84", "85"],
  RMPE: [...faixa(2, 4, 8), ...faixa(3, 4, 8), "64", "65", "74", "75"],
};
R.ASAI = [...R.AS, ...R.AI];
const NOTA = {
  S1: "Sextante: do 14 ao 18 (inclui o 3º molar) + 54 e 55 — conferir se o 18 entra",
  S3: "Sextante: do 24 ao 28 + 64 e 65 — conferir se o 28 entra",
  S4: "Sextante: do 34 ao 38 + 74 e 75 — conferir se o 38 entra",
  S6: "Sextante: do 44 ao 48 + 84 e 85 — conferir se o 48 entra",
  RCID: "O nome fala só do canino (o superior fala 'canino e lateral') — conferir",
  RCIE: "O nome fala só do canino (o superior fala 'canino e lateral') — conferir",
  RMD: "Molares superiores E inferiores do lado direito, com os molares decíduos",
  RME: "Molares superiores E inferiores do lado esquerdo, com os molares decíduos",
};
for (const k of ["AS", "AI", "HASD", "HASE", "HAIE", "HAID", "ASAI"]) NOTA[k] = "Inclui o supranumerário do hemiarco (x9) e os decíduos";
const linhasRegioes = REGIOES.slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((r) => {
    const dentes = R[r.id];
    return [r.id, r.display_name.trim(), dentes ? "Grupo de dentes" : "Tecido / osso (sem dentes)",
      dentes ? dentes.slice().sort((a, b) => num(a) - num(b)).join(", ") : "—", dentes ? dentes.length : 0, NOTA[r.id] ?? "", "", ""];
  });
salvar("2 - Faces por dente e dentes por região.xlsx", [
  ["Faces por dente", [
    ["Dente (FDI)", "Nome (TUSS 28)", "Dentição", "Arco", "Grupo", "Faces", "Faces por extenso", "Nota", "Decisão (Sim / Não / Ajustar)", "Observação"],
    ...linhasFaces,
  ], [11, 58, 12, 10, 16, 18, 52, 46, 26, 36]],
  ["Dentes por região", [
    ["Região (TUSS 42)", "Nome", "Tipo", "Dentes que a região seleciona", "Qtd.", "Nota", "Decisão (Sim / Não / Ajustar)", "Observação"],
    ...linhasRegioes,
  ], [10, 46, 26, 70, 6, 60, 26, 36]],
  ["Como revisar", [
    ["FACES E REGIÕES — o que revisar"],
    [""],
    ["Os arquivos TUSS trazem os dentes, as faces e as regiões, mas NÃO dizem quais faces valem para cada dente nem quais dentes cada região contém. Isto foi montado pela regra odontológica e precisa da sua conferência."],
    [""],
    ["Regra das faces", "Todo dente tem Vestibular, Mesial e Distal. Dente anterior (incisivo, canino) tem Incisal; posterior (pré-molar, molar) tem Oclusal. Superior tem Palatina; inferior tem Lingual."],
    ["Supranumerários", "Os dentes 19, 29, 39, 49, 59, 69, 79, 89 não têm posição fixa: deixei todas as faces liberadas. No desenho, só aparecem quando registrados."],
    ["Regiões", "'Grupo de dentes': ao escolher a região, o sistema seleciona estes dentes. 'Tecido / osso': a região pode receber achado (ex.: lesão na língua), mas não seleciona dente."],
    ["Decisão", "Sim = está certo. Não = está errado. Ajustar = escreva na Observação como deve ser."],
  ], [22, 140]],
]);

// =============================================================================
// 3) CLASSIFICAÇÃO DOS 370 PROCEDIMENTOS (D11)
// =============================================================================
const SEM = "Sem marcação no dente";
const REGRAS = [
  // [regex, nível, nº faces, grupo de dentes, impede, exige, efeito, confiança]
  [/provis[oó]rio para (faceta|inlay|onlay|restaura)/, "Face", () => "1 a 3", "Todos", "A, RZ-IMPLANTE", "", "RZ-RESTPROV", "Média"],
  [/curativo (de demora em|endod)|perfura[cç][aã]o endod|corpo estranho intracanal/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "", "Média"],
  [/abscesso periodontal|pericoronarite|odonto-sec|sepultamento radicular/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "", "Média"],
  [/remo[cç][aã]o de implante/, "Dente", null, "Todos", "", "RZ-IMPLANTE", "A", "Média"],
  [/cicatrizador|intermedi[aá]rio prot|manuten[cç][aã]o de pr[oó]tese sobre implante/, "Dente", null, "Todos", "", "RZ-IMPLANTE", "", "Média"],
  [/guia cir[uú]rgico|aparelho protetor bucal|aparelho ortod[oô]ntico remov/, "Arcada", null, "—", "", "", "", "Média"],
  [/restaura[cç][aã]o .*(\d) faces?/, "Face", (m) => m[1], "Todos", "A, RZ-IMPLANTE, RZ-COROA", "", "R", "Alta"],
  [/restaura[cç][aã]o .*(inlay|onlay)|restaura[cç][aã]o met[aá]lica fundida|onlay de resina/, "Face", () => "1 a 3", "Posteriores", "A, RZ-IMPLANTE, RZ-COROA", "", "R", "Média"],
  [/restaura[cç][aã]o atraum[aá]tica/, "Face", () => "1 a 3", "Todos", "A, RZ-IMPLANTE", "", "R", "Média"],
  [/restaura[cç][aã]o tempor[aá]ria/, "Face", () => "1 a 3", "Todos", "A, RZ-IMPLANTE", "", "RZ-RESTPROV", "Média"],
  [/provis[oó]rio para (faceta|inlay|onlay|restaura)/, "Face", () => "1 a 3", "Todos", "A, RZ-IMPLANTE", "", "RZ-RESTPROV", "Média"],
  [/faceta/, "Face", () => "1 (Vestibular)", "Anteriores", "A, RZ-IMPLANTE", "", "RZ-FACETA", "Alta"],
  [/selante/, "Face", () => "1 (Oclusal)", "Posteriores", "A, RZ-IMPLANTE, RZ-COROA", "", "RZ-SELANTE", "Alta"],
  [/coroa .*sobre implante|coroa provis[oó]ria sobre implante/, "Dente", null, "Todos", "", "RZ-IMPLANTE", "RZ-COROAIMP", "Alta"],
  [/tratamento de perimplantite/, "Dente", null, "Todos", "", "RZ-IMPLANTE", "", "Alta"],
  [/implante [oó]sseo integrado/, "Dente", null, "Todos", "RZ-IMPLANTE", "A ou E (extração planejada antes)", "RZ-IMPLANTE", "Alta"],
  [/implante zigom|implante ortod/, "Região", null, "—", "", "", "", "Média"],
  [/retratamento endod/, "Dente", null, null, "A, RZ-IMPLANTE", "RZ-ENDO", "RZ-ENDO", "Alta"],
  [/tratamento endod|pulpectomia/, "Dente", null, null, "A, RZ-IMPLANTE, RZ-ENDO", "", "RZ-ENDO", "Alta"],
  [/pulpotomia|capeamento pulpar/, "Dente", null, null, "A, RZ-IMPLANTE, RZ-ENDO", "", "", "Média"],
  [/apicetomia|amputa[cç][aã]o radicular|curetagem apical/, "Dente", null, null, "A, RZ-IMPLANTE", "RZ-ENDO", "", "Alta"],
  [/n[uú]cleo|pino pr[eé]/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "RZ-ENDO", "RZ-NUCLEO", "Alta"],
  [/coroa provis[oó]ria/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "RZ-COROAPROV", "Alta"],
  [/coroa (total|3\/4|de a[cç]o|de policarbonato|de acetato)|coroa total/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "RZ-COROA", "Alta"],
  [/pr[oó]tese parcial fixa|pr[oó]tese fixa adesiva/, "Dente", null, "Todos", "", "", "RZ-PFPILAR (pilar) / RZ-PFPONTICO (pôntico)", "Média"],
  [/protocolo branemark|overdenture|barra clipe/, "Arcada", null, "—", "", "RZ-IMPLANTE (nos implantes)", "RZ-PT", "Média"],
  [/pr[oó]tese total/, "Arcada", null, "—", "", "", "RZ-PT", "Alta"],
  [/pr[oó]tese parcial remov/, "Arcada", null, "—", "", "", "RZ-PPR", "Alta"],
  [/conserto em pr[oó]tese|reembasamento de pr[oó]tese/, "Arcada", null, "—", "", "", "", "Média"],
  [/recimenta|reembasamento de coroa|remo[cç][aã]o de trabalho prot|ponto de solda/, "Dente", null, "Todos", "", "", "", "Média"],
  [/exodontia|remo[cç][aã]o de dentes (semi-)?inclusos|remo[cç][aã]o de odontoma/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "A", "Alta"],
  [/raiz residual/, "Dente", null, "Todos", "", "RZ-RAIZRES", "A", "Média"],
  [/clareamento de dente desvitalizado/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "RZ-ENDO", "", "Alta"],
  [/clareamento/, SEM, null, "—", "", "", "", "Média"],
  [/mantenedor de espa[cç]o/, "Região", null, "—", "", "A", "", "Média"],
  [/raspagem|alisamento|gengivectomia|gengivoplastia|cirurgia periodontal|cunha proximal|manuten[cç][aã]o periodontal/, "Região", null, "—", "", "", "", "Média"],
  [/aumento de coroa cl[ií]nica|tracionamento|reimplante|colagem de fragmentos|imobiliza[cç][aã]o dent[aá]ria/, "Dente", null, "Todos", "A, RZ-IMPLANTE", "", "", "Média"],
  [/enxerto|regenera[cç][aã]o|levantamento do seio|plasma rico|alveoloplastia/, "Região", null, "—", "", "", "", "Média"],
  [/radiografia periapical|radiografia interproximal/, "Dente", null, "Todos", "", "", "", "Média"],
  [/radiografia|telerradiografia|tomografia|tra[cç]ado|levantamento radiogr|fotografia|slide|modelos|documenta[cç][aã]o|enceramento/, SEM, null, "—", "", "", "", "Alta"],
  [/aparelho ortod[oô]ntico fixo|contenç[aã]o fixa/, "Arcada", null, "—", "", "", "RZ-APARELHO", "Média"],
  [/órtese|ortese|placa oclusal|jig|front plato|ajuste oclusal/, "Arcada", null, "—", "", "", "", "Média"],
  [/consulta|condicionamento|atividade educativa|adequa[cç][aã]o do meio|profilaxia|biofilme|fl[uú]or|verniz|cariost[aá]tico|remineraliza|teste |dessensibiliza|diagn[oó]stico|halitose|xerostomia|estomatite|tratamento de fluorose|laser|seda[cç][aã]o|estabiliza[cç][aã]o|planejamento em pr[oó]tese|placa de acetato/, SEM, null, "—", "", "", "", "Média"],
  [/bi[oó]psia|cisto|tumor|les[aã]o|drenagem|frenul|bridotomia|bridectomia|exostose|torus|mucocele|r[aâ]nula|lipoma|f[ií]stula|hiperplasia|corpo estranho|dreno|sutura|hemorragia|fratura|luxa|atm|criocirurgia|crioterapia|marsupializa|ulectomia|ulotomia|tuneliza|alveolite|vest[ií]bulo|seio maxilar|tamponamento|raspado|pun[cç][aã]o|reeduca|sepultamento|odonto-sec|meios de fixa|placa de conten|retalho|aloenxerto|acompanhamento|controle p[oó]s/, "Região", null, "—", "", "", "", "Baixa"],
];
function grupoPorRaiz(nome) {
  if (/unirradicular/.test(nome)) return "Unirradiculares (anteriores e alguns pré-molares)";
  if (/birradicular/.test(nome)) return "Birradiculares (pré-molares)";
  if (/multirradicular/.test(nome)) return "Multirradiculares (molares)";
  return "Todos";
}
function classificar(nomeOriginal, tuss) {
  const nome = nomeOriginal.toLowerCase();
  const denticao = /dec[ií]duo/.test(nome) ? "Decídua" : /permanente/.test(nome) ? "Permanente" : "Ambas";
  for (const [re, nivel, faces, grupoDentes, impede, exige, efeito, conf] of REGRAS) {
    const m = nome.match(re);
    if (m) {
      return { nivel, faces: faces ? faces(m) : "—", denticao, grupo: grupoDentes ?? grupoPorRaiz(nome), impede, exige, efeito, conf };
    }
  }
  // Ortodontia sem regra própria: aparelho/arcada; o resto, sem marcação.
  if (String(tuss).startsWith("86")) return { nivel: "Arcada", faces: "—", denticao, grupo: "—", impede: "", exige: "", efeito: "", conf: "Baixa" };
  return { nivel: SEM, faces: "—", denticao, grupo: "—", impede: "", exige: "", efeito: "", conf: "Baixa" };
}

(async () => {
  const env = {};
  for (const l of fs.readFileSync(`${RAIZ}/.env.local`, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("hvhbijctanrrkxhemlza")) throw new Error("não é a produção");
  const prod = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await prod.from("procedures").select("code, tuss_code, name, specialty, is_active").order("code");
  if (error) throw new Error(error.message);
  const odonto = data.filter((p) => /^8[1-7]\d{6}$/.test(p.tuss_code ?? ""));
  if (odonto.length === 0) throw new Error("nenhum procedimento odontológico lido — régua errada");

  const conta = { Alta: 0, Média: 0, Baixa: 0 };
  const porNivel = {};
  const linhas = odonto.map((p) => {
    const c = classificar(p.name, p.tuss_code);
    conta[c.conf]++;
    porNivel[c.nivel] = (porNivel[c.nivel] ?? 0) + 1;
    return [p.code, p.tuss_code, p.name, p.specialty ?? "", c.nivel, c.faces, c.denticao, c.grupo, c.impede, c.exige, c.efeito, c.conf, "", ""];
  });
  salvar("3 - Classificação dos procedimentos.xlsx", [
    ["Procedimentos", [
      ["Código", "TUSS", "Procedimento", "Especialidade", "Nível (sugerido)", "Nº de faces", "Dentição", "Dentes compatíveis", "Situações que IMPEDEM", "Situação EXIGIDA", "Efeito depois de realizado", "Confiança da sugestão", "Decisão (Sim / Não / Ajustar)", "Observação"],
      ...linhas,
    ], [11, 10, 62, 22, 22, 13, 12, 30, 30, 26, 32, 12, 26, 36]],
    ["Como revisar", [
      ["CLASSIFICAÇÃO DOS PROCEDIMENTOS — o que revisar"],
      [""],
      ["A TUSS não diz se um procedimento é feito num dente, numa face, numa região ou na boca toda, nem o que ele muda no dente. O sistema SUGERIU, pelo nome. Nada disto vale antes da sua revisão."],
      [""],
      ["Coluna", "O que significa"],
      ["Nível", "Face = escolhe dente e face(s). Dente = escolhe o dente. Região = escolhe uma região (sextante, grupo de dentes, tecido). Arcada = superior/inferior. Sem marcação no dente = não aparece no desenho (consulta, exame, teste)."],
      ["Situações que IMPEDEM", "Códigos da planilha 1. Ex.: restauração não se faz em dente Ausente (A) nem em Implante (RZ-IMPLANTE)."],
      ["Situação EXIGIDA", "Ex.: coroa sobre implante exige Implante; retratamento de canal exige canal tratado (RZ-ENDO)."],
      ["Efeito", "O que o dente passa a ter depois de realizado. Ex.: exodontia → Ausente (A); canal → RZ-ENDO; restauração → Restaurado (R)."],
      ["Confiança", "Alta = o nome deixa claro. Média = regra geral. Baixa = palpite — olhe com mais atenção."],
      ["Decisão", "Sim = está certo. Não = está errado. Ajustar = escreva na Observação."],
      [""],
      ["Sugestão de ordem: comece pelos de confiança Baixa e pelos que a rede mais usa."],
    ], [26, 140]],
  ]);
  console.log("procedimentos:", linhas.length, "| confiança:", conta, "| por nível:", porNivel);
})().catch((e) => { console.error(e.message); process.exit(1); });
