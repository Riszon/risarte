// LÊ O docs/BACKLOG.md E DEVOLVE OS ITENS PARA A IMPORTAÇÃO (BK1, 0366).
//
// Puro (recebe o texto, devolve a lista) e com teste:
// src/lib/__tests__/backlog-do-arquivo.test.ts.
//
// De onde vem cada coisa:
// - os itens AP são as seções "### APn." (detalhe = o texto da seção);
// - a SITUAÇÃO vem do índice do topo ([ ] / [x]) quando o item está lá; fora
//   dele, das marcas do título (✅, RESOLVIDO, CORRIGIDO…);
// - CATEGORIA e PRIORIDADE dos ABERTOS são as da tabela ABERTOS abaixo,
//   escrita à mão item por item (o dono ajusta na tela). Item aberto que não
//   está na tabela DERRUBA a importação: nada entra classificado por palpite.
// - os resolvidos levam a categoria por palavras do título e prioridade média
//   (já não pesam na fila).

/** Categoria, prioridade, módulo e situação de cada item ABERTO (04/11/2026). */
export const ABERTOS = {
  11: { categoria: "Defeito", prioridade: "media", modulo: "geral" },
  16: { categoria: "Segurança e LGPD", prioridade: "alta", modulo: null },
  17: { categoria: "Tarefa do dono", prioridade: "media", modulo: null, situacao: "aguardando_dono" },
  27: { categoria: "Melhoria", prioridade: "media", modulo: "financeiro" },
  31: { categoria: "Defeito", prioridade: "media", modulo: null },
  32: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: null },
  33: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: null },
  38: { categoria: "Defeito", prioridade: "baixa", modulo: "empresarial" },
  40: { categoria: "Limpeza técnica", prioridade: "media", modulo: null },
  56: { categoria: "Defeito", prioridade: "alta", modulo: "agenda" },
  57: { categoria: "Defeito", prioridade: "baixa", modulo: "administracao" },
  67: { categoria: "Segurança e LGPD", prioridade: "media", modulo: "financeiro" },
  68: { categoria: "Desempenho", prioridade: "baixa", modulo: "financeiro" },
  69: { categoria: "Decisão do dono", prioridade: "alta", modulo: "financeiro", situacao: "aguardando_dono" },
  70: { categoria: "Defeito", prioridade: "media", modulo: "ppr" },
  71: { categoria: "Defeito", prioridade: "baixa", modulo: "compras" },
  72: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: "clinico" },
  74: { categoria: "Melhoria", prioridade: "baixa", modulo: "empresarial" },
  75: { categoria: "Melhoria", prioridade: "baixa", modulo: "empresarial" },
  76: { categoria: "Defeito", prioridade: "media", modulo: "clinico" },
  77: { categoria: "Defeito", prioridade: "media", modulo: "procedimentos" },
  78: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: "procedimentos" },
  79: { categoria: "Melhoria", prioridade: "baixa", modulo: "procedimentos" },
  81: { categoria: "Defeito", prioridade: "media", modulo: "comercial" },
  82: { categoria: "Desempenho", prioridade: "baixa", modulo: "financeiro" },
  83: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: null, nota: "Mesmo achado do AP88." },
  84: { categoria: "Defeito", prioridade: "media", modulo: "comercial" },
  85: { categoria: "Defeito", prioridade: "media", modulo: "planejamento" },
  86: { categoria: "Defeito", prioridade: "baixa", modulo: "geral" },
  88: { categoria: "Limpeza técnica", prioridade: "baixa", modulo: null, nota: "Mesmo achado do AP83." },
  92: { categoria: "Melhoria", prioridade: "baixa", modulo: "empresarial" },
  94: { categoria: "Melhoria", prioridade: "media", modulo: "comercial" },
  98: { categoria: "Defeito", prioridade: "media", modulo: "agenda" },
  102: { categoria: "Segurança e LGPD", prioridade: "alta", modulo: null },
  106: { categoria: "Defeito", prioridade: "media", modulo: "administracao" },
  109: { categoria: "Defeito", prioridade: "alta", modulo: "agenda" },
  111: { categoria: "Defeito", prioridade: "alta", modulo: "empresarial" },
};

/**
 * O índice está desatualizado nestes (conferido em 04/11/2026): a situação de
 * verdade, com a origem.
 */
export const CORRECOES = {
  87: {
    situacao: "resolvido",
    categoria: "Segurança e LGPD",
    resolvidoEm: "2026-11-03",
    versao: "0.390.0",
    como: "Migração 1039 (AP95, entrega 2): o Consultor RisLife só vê as empresas e os leads dele; is_program_manager() não o inclui mais.",
  },
  100: {
    situacao: "resolvido",
    resolvidoEm: "2026-11-04",
    versao: "Indica 0.8.0",
    como: "Migração 2010: o token do convite saiu da fila (indica.convites_tokens, só a chave de serviço); a fila guarda só /c/.",
  },
  101: {
    situacao: "resolvido",
    categoria: "Segurança e LGPD",
    resolvidoEm: "2026-11-04",
    versao: "Indica 0.8.0",
    como: "Migração 2010: a rotina diária anonimiza também a fila de mensagens.",
  },
  61: {
    situacao: "aguardando_dono",
    categoria: "Decisão do dono",
    prioridade: "media",
    modulo: "financeiro",
    nota: "Implementado na 0.386.0 (0352). Falta o dono confirmar: o repasse vai para quem concluiu a ÚLTIMA sessão do procedimento.",
  },
};

/** Títulos reescritos onde o do arquivo não se explica sozinho. */
export const TITULOS = {
  17: "Academy: rodar a consulta só de leitura das 5 funções (a janela da 0277 pode esconder a função dos novatos)",
  31: "Indica: a tela de apuração da equipe responde 404 para o Admin Master",
  32: "Indica: 3 conferências do test:indica falham no treino",
  36: "Empresarial: reabrir negociação perdida (o dono escolheu \"reabrir a mesma ficha\")",
  39: "Empresarial: ganho e implantação sem os selos e a conferência (era brecha)",
};

/** Abertos que não têm código AP no arquivo — ganham código na importação. */
export const SEM_CODIGO = [
  {
    titulo: "Indica: como a equipe USA os Riso Coins do prêmio individual (era AP24b)",
    detalhe:
      "Resgatar no catálogo, virar voucher, só ranking? Hoje os Riso Coins do prêmio individual (AP24, Indica 0.9.0) só acumulam e aparecem na tela Equipe; não há resgate para a equipe. Também fica de fora o `beneficio_indicado` da campanha (o presente usa sempre o parâmetro da rede/unidade).",
    categoria: "Decisão do dono", prioridade: "media", modulo: null, situacao: "aguardando_dono",
  },
  {
    titulo: "Grupos de procedimentos: orçamento e apresentação agrupados, com subtotal do grupo",
    detalhe: "GP3: \"não agora\"; só se o Comercial pedir — `docs/procedimentos/GRUPOS-PLANO.md`.",
    categoria: "Adiado", prioridade: "baixa", modulo: "procedimentos",
  },
  {
    titulo: "Medalha de META atingida (OC-00133)",
    detalhe: "Decisão M1: ficou para depois; esbarra na R4 das Metas (o resultado de cada pessoa só é visto por quem edita a meta e por ela). `docs/certificacao/OC-00133-PLANO.md`.",
    categoria: "Adiado", prioridade: "baixa", modulo: "administracao",
  },
  { titulo: "Gênero no cadastro (rótulos \"Coordenadora/Coordenador\")", detalhe: "Adiado do início do projeto.", categoria: "Adiado", prioridade: "baixa", modulo: "jornada" },
  { titulo: "Foto do cliente pela webcam", detalhe: "Adiado do início do projeto.", categoria: "Adiado", prioridade: "baixa", modulo: "jornada" },
  { titulo: "Semana começando no domingo + esconder fim de semana sem agendamento", detalhe: "Adiado do início do projeto.", categoria: "Adiado", prioridade: "baixa", modulo: "agenda" },
  { titulo: "Funcionar sem internet (offline / sincronização)", detalhe: "Adiado do início do projeto.", categoria: "Adiado", prioridade: "baixa", modulo: "geral" },
  { titulo: "Consolidação financeira na transferência de cliente", detalhe: "Adiado do início do projeto.", categoria: "Adiado", prioridade: "baixa", modulo: "financeiro" },
  { titulo: "Revisar as marcações da lista H4 (quase todos os módulos já existem; as caixas estão velhas)", detalhe: "Adiado do início do projeto.", categoria: "Limpeza técnica", prioridade: "baixa", modulo: null },
  {
    titulo: "Renovar o Supabase Pro (vencia em 30/10/2026)",
    detalhe: "Registrado no CLAUDE.md como tarefa do dono. Conferir no painel do Supabase se a assinatura foi renovada.",
    categoria: "Tarefa do dono", prioridade: "urgente", modulo: null, situacao: "aguardando_dono",
  },
  { titulo: "Definir as metas da certificação (em branco na produção)", detalhe: "Tarefa do dono, registrada no CLAUDE.md.", categoria: "Tarefa do dono", prioridade: "media", modulo: "administracao", situacao: "aguardando_dono" },
  { titulo: "Cadastrar os benefícios padrão da rede do Empresarial na produção", detalhe: "Tarefa do dono, registrada no CLAUDE.md.", categoria: "Tarefa do dono", prioridade: "media", modulo: "empresarial", situacao: "aguardando_dono" },
  { titulo: "Digitar os dados de quem assina pela Risarte no contrato do Empresarial (os dois ambientes)", detalhe: "Tarefa do dono, registrada no CLAUDE.md.", categoria: "Tarefa do dono", prioridade: "media", modulo: "empresarial", situacao: "aguardando_dono" },
  { titulo: "Ligar \"Criar requisição de compra\" para o Financeiro da Franqueadora na matriz", detalhe: "Tarefa do dono, registrada no CLAUDE.md. O banco já aceita.", categoria: "Tarefa do dono", prioridade: "baixa", modulo: "compras", situacao: "aguardando_dono" },
];

/** O primeiro código livre para os itens sem código (o arquivo vai até AP111). */
export const PRIMEIRO_CODIGO_NOVO = 112;

const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const MARCA_RESOLVIDO = /✅|RESOLVID|Resolvid|CORRIGID|corrigid|RESPONDID|ENCERRADO|DECIDIDO/;
const VERSAO = /\b(\d+\.\d+\.\d+)\b/;

function iso(m) {
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function limparTitulo(cabecalho) {
  let t = cabecalho.replace(/^[✅⚠️🔴️\s]+/u, "").trim();
  // "RESOLVIDO em 25/09/2026 (…) — o título" → "o título"
  const partes = t.split(" — ");
  if (partes.length > 1 && MARCA_RESOLVIDO.test(partes[0]) && !/\w{4,}.*\w{4,}.*\w{4,}/.test(partes[0].replace(/RESOLVID\w*|RESPONDID\w*|em \d\d\/\d\d\/\d{4}|\(.*?\)/g, ""))) {
    t = partes.slice(1).join(" — ");
  } else {
    // "o título (data) — ✅ RESOLVIDO…" → "o título (data)"
    t = partes.filter((p, i) => i === 0 || !/^(✅|CONFIRMADO|DECIDIDO|DECISÃO|SUSPEITA|EXIGÊNCIA|da sessão)/.test(p.trim()))
      .join(" — ");
  }
  // tira a data do fim: "(26/09/2026)" ou "(26/09/2026 — corrigido, …)"
  t = t.replace(/\s*\((\d{2}\/\d{2}\/\d{4})[^)]*\)\s*$/, "").replace(/\s*\((\d{2}\/\d{2}\/\d{4})[^)]*\)/, "");
  t = t.replace(/^[✅⚠️🔴️\s]+/u, "").trim();
  return t.length > 300 ? `${t.slice(0, 297)}…` : t;
}

function categoriaDoResolvido(texto) {
  if (/DECIDIDO|DECISÃO DO DONO|RESPONDIDO/.test(texto)) return "Decisão do dono";
  if (/sem login|LGPD|sem guarda|guarda|brecha|tranca|trava ABERTA|token|webhook|privadas|expunha|anonimiz/i.test(texto)) return "Segurança e LGPD";
  if (/1\.000|lent|desempenho/i.test(texto)) return "Desempenho";
  return "Defeito";
}

/**
 * @param {string} texto o conteúdo de docs/BACKLOG.md
 * @returns {{ code: string, title: string, detail: string, category: string,
 *   priority: string, status: string, module: string|null, foundOn: string|null,
 *   resolvedOn: string|null, resolvedVersion: string|null, resolution: string|null,
 *   note: string|null }[]}
 */
export function itensDoArquivo(texto) {
  const s = texto.replace(/\r\n/g, "\n");
  const ini = s.indexOf("## ☑️ CHECKLIST");
  const fim = s.indexOf("## Princípios");
  if (ini < 0 || fim < 0) throw new Error("NÃO MEDI: o índice do BACKLOG.md não foi encontrado");
  const indice = s.slice(ini, fim);

  const doIndice = new Map();
  for (const m of indice.matchAll(/^- \[( |x)\] \*\*AP(\d+)[^*]*\*\*\s*—\s*(.*)$/gm)) {
    doIndice.set(Number(m[2]), { feito: m[1] === "x", linha: m[3].trim() });
  }
  if (doIndice.size === 0) throw new Error("NÃO MEDI: nenhuma linha AP no índice");

  // Seções "### APn." — o texto vai até o próximo título de nível 1 a 3.
  const linhas = s.split("\n");
  const secoes = new Map();
  for (let i = 0; i < linhas.length; i++) {
    const m = /^###\s+(?:✅\s+)?AP(\d+)\.\s*(.*)$/.exec(linhas[i]);
    if (!m) continue;
    const n = Number(m[1]);
    if (secoes.has(n)) continue;
    let j = i + 1;
    while (j < linhas.length && !/^#{1,3}\s/.test(linhas[j])) j++;
    const corpo = linhas.slice(i + 1, j).join("\n").replace(/\n-{3,}\s*$/, "").trim();
    secoes.set(n, { cabecalho: m[2].trim(), corpo });
  }
  if (secoes.size < 100) throw new Error(`NÃO MEDI: só ${secoes.size} seções AP`);

  const numeros = [...new Set([...secoes.keys(), ...doIndice.keys()])].sort((a, b) => a - b);
  const itens = [];
  for (const n of numeros) {
    const sec = secoes.get(n);
    const ind = doIndice.get(n);
    const correcao = CORRECOES[n];
    const cab = sec?.cabecalho ?? "";
    const linhaIndice = ind?.linha ?? "";

    let status;
    if (correcao?.situacao) status = correcao.situacao;
    else if (ind) status = ind.feito ? "resolvido" : "aberto";
    else status = MARCA_RESOLVIDO.test(cab) || /\*\*ENCERRADO/.test(sec?.corpo ?? "") ? "resolvido" : "aberto";

    const aberto = status !== "resolvido" && status !== "descartado";
    const cls = ABERTOS[n] ?? (correcao?.categoria ? correcao : null);
    if (aberto && !cls) throw new Error(`AP${n} está aberto e não tem classificação em ABERTOS`);
    if (aberto && cls?.situacao) status = cls.situacao;

    // Título: o do índice para os abertos (a redação atual); senão o da seção.
    const indiceSemFecho = linhaIndice.split(/\s+—\s+\*\*/)[0].replace(/\*\*/g, "").trim();
    let title = aberto && indiceSemFecho ? indiceSemFecho : limparTitulo(cab || indiceSemFecho);
    if (TITULOS[n]) title = TITULOS[n];
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > 300) title = `${title.slice(0, 297)}…`;

    let detail = sec?.corpo ?? "";
    if (linhaIndice) detail = `${detail}${detail ? "\n\n---\n\n" : ""}**No índice do BACKLOG.md:** ${linhaIndice}`;

    const foundOn = iso(DATA.exec(cab)) ?? iso(DATA.exec(sec?.corpo ?? "")) ?? iso(DATA.exec(linhaIndice));

    let resolvedOn = null;
    let resolvedVersion = null;
    let resolution = null;
    if (!aberto) {
      const fecho = linhaIndice.includes("**") ? linhaIndice.split(/\s+—\s+\*\*/).slice(1).join(" ").replace(/\*\*/g, "") : "";
      const fonte = `${cab} ${fecho}`;
      const dataFecho =
        /(?:RESOLVID\w*|Resolvid\w*|CORRIGID\w*|corrigid\w*|ENCERRADO|RESPONDID\w*)[^0-9\n]{0,25}(\d{2})\/(\d{2})\/(\d{4})/.exec(fonte) ??
        /(?:DECIDID\w*|decidido)[^0-9\n]{0,25}(\d{2})\/(\d{2})\/(\d{4})/.exec(fonte);
      resolvedOn = correcao?.resolvidoEm ?? (dataFecho ? `${dataFecho[3]}-${dataFecho[2]}-${dataFecho[1]}` : foundOn);
      resolvedVersion = correcao?.versao ?? VERSAO.exec(fonte)?.[1] ?? null;
      resolution = correcao?.como ?? (fecho.trim() || cab.split(" — ").filter((p) => MARCA_RESOLVIDO.test(p)).join(" — ") || null);
      if (resolution && resolution.length > 500) resolution = `${resolution.slice(0, 497)}…`;
    }

    itens.push({
      code: `AP${n}`,
      title,
      detail,
      category: aberto ? cls.categoria : (correcao?.categoria ?? categoriaDoResolvido(cab + " " + linhaIndice)),
      priority: aberto ? cls.prioridade : "media",
      status,
      module: aberto ? cls.modulo : null,
      foundOn,
      resolvedOn,
      resolvedVersion,
      resolution,
      note: (aberto ? cls.nota : null) ?? correcao?.nota ?? null,
    });
  }

  // Abertos da tabela que o arquivo não tem: a tabela está errada — falha alto.
  for (const n of Object.keys(ABERTOS)) {
    const it = itens.find((i) => i.code === `AP${n}`);
    if (!it) throw new Error(`AP${n} está em ABERTOS mas não existe no arquivo`);
    if (it.status === "resolvido") throw new Error(`AP${n} está em ABERTOS mas o arquivo o dá como resolvido`);
  }

  SEM_CODIGO.forEach((x, i) => {
    itens.push({
      code: `AP${PRIMEIRO_CODIGO_NOVO + i}`,
      title: x.titulo,
      detail: x.detalhe,
      category: x.categoria,
      priority: x.prioridade,
      status: x.situacao ?? "aberto",
      module: x.modulo,
      foundOn: null,
      resolvedOn: null,
      resolvedVersion: null,
      resolution: null,
      note: null,
    });
  });
  return itens;
}
