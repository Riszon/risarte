import { describe, expect, it } from "vitest";
import { CHANGELOG, novidadesPara, versaoMaisRecente } from "@/lib/changelog";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { USER_ROLES } from "@/lib/roles";

// ⚠️ ESTE ARQUIVO É O QUE FAZ A REGRA DA SEÇÃO 0c DO CLAUDE.md VALER.
//
// A regra diz "toda entrega que a equipe percebe atualiza o manual e as
// novidades". Regra que depende de alguém lembrar morre em duas semanas — a
// primeira entrega apertada passa sem, a segunda também, e em um mês o registro
// vira arqueologia. Aqui ela deixa de depender de memória: bumpar a versão sem
// escrever a novidade QUEBRA O PORTÃO DE ENTREGA.
describe("registro de novidades", () => {
  it("a versão publicada tem entrada no registro", () => {
    expect(versaoMaisRecente().versao).toBe(APP_VERSION);
  });

  it("a migração declarada casa com a do sistema", () => {
    // Entrega sem migração declara `null` — e aí a última migração continua
    // sendo a da entrega anterior, que já está no registro.
    const comMigracao = CHANGELOG.find((v) => v.migracao !== null);
    expect(comMigracao?.migracao).toBe(LATEST_MIGRATION);
  });

  it("não repete versão", () => {
    const vistas = CHANGELOG.map((v) => v.versao);
    expect(new Set(vistas).size).toBe(vistas.length);
  });

  it("vem da mais recente para a mais antiga", () => {
    // Se a ordem inverter, a tela abre mostrando o que mudou em agosto como se
    // fosse a novidade de hoje.
    const datas = CHANGELOG.map((v) => v.data);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it("toda entrada tem data ISO, título e ao menos uma mudança", () => {
    for (const v of CHANGELOG) {
      expect(v.data, v.versao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(v.data)), v.versao).toBe(false);
      expect(v.titulo.trim().length, v.versao).toBeGreaterThan(0);
      expect(v.mudancas.length, v.versao).toBeGreaterThan(0);
    }
  });

  it("só cita papéis que existem", () => {
    // Papel escrito errado sumiria da tela em silêncio: a pessoa certa nunca
    // veria a novidade, e ninguém descobriria olhando.
    for (const v of CHANGELOG) {
      for (const m of v.mudancas) {
        if (m.papeis === "todos") continue;
        for (const p of m.papeis) {
          expect(USER_ROLES, `${v.versao}: ${p}`).toContain(p);
        }
      }
    }
  });
});

describe("novidades por papel", () => {
  it("o Admin Master vê o registro inteiro", () => {
    expect(novidadesPara([], true)).toEqual(CHANGELOG);
  });

  it("quem não é do papel citado não recebe a mudança específica", () => {
    // A correção do CPF é da recepção e da SDR; um dentista não precisa dela.
    const doDentista = novidadesPara(["dentist"], false);
    const textos = doDentista.flatMap((v) => v.mudancas.map((m) => m.texto));
    expect(textos.some((t) => t.includes("CPF digitado com e sem"))).toBe(false);
  });

  it("mudança 'todos' chega a qualquer papel", () => {
    const daRecepcao = novidadesPara(["receptionist"], false);
    expect(daRecepcao.length).toBeGreaterThan(0);
    expect(
      daRecepcao[0].mudancas.every(
        (m) => m.papeis === "todos" || m.papeis.includes("receptionist")
      )
    ).toBe(true);
  });

  it("versão que sobrou sem nenhuma mudança some da lista", () => {
    // Senão a tela mostraria um cabeçalho de versão com nada embaixo.
    const doComprador = novidadesPara(["purchaser"], false);
    expect(doComprador.every((v) => v.mudancas.length > 0)).toBe(true);
  });
});
