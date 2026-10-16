import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeStatement,
  limparDescricao,
  parseCsv,
  parseDate,
} from "@/lib/finance/reconciliation";

// Relato OC-00103 (Financeiro da Franqueadora, treino, 15/10/2026): o extrato
// do Inter não importava, nem em OFX nem em CSV — só "Não foi possível
// importar o extrato." A causa estava no BANCO: a API do Supabase carrega o
// `safeupdate`, que recusa DELETE sem WHERE, e a função esvaziava a tabela
// temporária com `delete from tmp_import_keys;`. Passava em todo teste pela
// conexão direta e quebrava na tela. De carona, três defeitos do leitor que a
// mesma mensagem genérica escondia.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("a função de importação não esvazia tabela sem WHERE", () => {
  it("a definição MAIS RECENTE de import_bank_transactions declara o alcance", () => {
    const pasta = join(RAIZ, "supabase", "migrations");
    const definem = readdirSync(pasta)
      .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
      .sort()
      .filter((f) =>
        /create\s+or\s+replace\s+function\s+public\.import_bank_transactions\s*\(/i.test(
          readFileSync(join(pasta, f), "utf8")
        )
      );
    expect(definem.length).toBeGreaterThan(0);
    // Só o código: o comentário da migração cita o comando antigo para explicar.
    const ultima = readFileSync(join(pasta, definem.at(-1)!), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(ultima).toMatch(/delete from tmp_import_keys where true;/);
    expect(ultima).not.toMatch(/delete from tmp_import_keys;/);
  });

  it("a conferência das migrações reprova DELETE/UPDATE sem WHERE em função (Regra 10)", () => {
    const regua = ler("scripts/check-migrations.mjs");
    expect(regua).toContain("Regra 10");
    expect(regua).toContain("DELETE requires a WHERE clause");
  });
});

describe("o arquivo é lido na codificação em que veio", () => {
  // "Transferência" em UTF-8 (ê = C3 AA) e em Latin-1 (ê = EA).
  const palavra = "Transfer";
  const ascii = [...palavra].map((c) => c.charCodeAt(0));
  const fim = [0x6e, 0x63, 0x69, 0x61]; // "ncia"
  const emUtf8 = new Uint8Array([...ascii, 0xc3, 0xaa, ...fim]);
  const emLatin1 = new Uint8Array([...ascii, 0xea, ...fim]);
  const certo = "Transfer" + String.fromCharCode(0xea) + "ncia";

  it("UTF-8 (o Inter) não estraga o acento", () => {
    expect(decodeStatement(emUtf8)).toBe(certo);
  });
  it("Latin-1 (a maioria dos bancos) continua certo", () => {
    expect(decodeStatement(emLatin1)).toBe(certo);
  });
  it("a marca de UTF-8 no começo do arquivo não vira caractere", () => {
    expect(decodeStatement(new Uint8Array([0xef, 0xbb, 0xbf, ...emUtf8]))).toBe(certo);
  });
  it("a tela lê os BYTES e escolhe a codificação (não fixa Latin-1)", () => {
    const tela = ler("src/app/(app)/financeiro/conciliacao/reconciliation-board.tsx");
    expect(tela).toContain("reader.readAsArrayBuffer(file);");
    expect(tela).toMatch(/parseStatement\(decodeStatement\(bytes\)\)/);
    expect(tela).not.toContain('readAsText(file, "windows-1252")');
  });
});

describe("linha impossível fica de fora, em vez de derrubar a importação", () => {
  it("data que não existe no calendário não é data", () => {
    expect(parseDate("10/14/2026")).toBeNull(); // dia e mês trocados → mês 14
    expect(parseDate("30/02/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("20261340")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29"); // ano bissexto
    expect(parseDate("30/09/2026")).toBe("2026-09-30");
  });

  it("a linha com data impossível conta entre as ignoradas", () => {
    const r = parseCsv(
      "Data Lançamento;Histórico;Descrição;Valor\n30/09/2026;Pix;A;220\n31/09/2026;Pix;B;10"
    );
    expect(r.transactions.map((t) => t.postedAt)).toEqual(["2026-09-30"]);
    expect(r.skipped).toBe(1);
  });

  it("caractere invisível (o nulo, sobretudo) sai da descrição", () => {
    const nulo = String.fromCharCode(0);
    const c1 = String.fromCharCode(0x81);
    expect(limparDescricao(`Pix${nulo}recebido${c1}  já`)).toBe("Pix recebido já");
    const r = parseCsv(`Data;Descrição;Valor\n30/09/2026;Tarifa${nulo};-5,00`);
    expect(r.transactions[0].description).toBe("Tarifa");
  });
});
