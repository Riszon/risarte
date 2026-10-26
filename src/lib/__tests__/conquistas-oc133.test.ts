import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  certificadoEm,
  explicacaoDoSelo,
  funcoesCertificadas,
  selosDeCertificacao,
  type CertificadoLido,
} from "@/lib/conquistas";
import { lerFiltros, passaNoFiltro, type PessoaDaEquipe } from "@/lib/risartanos";

// OC-00133 (26/10/2026): as certificações à vista — medalha por função na
// lista e na ficha de Risartanos e no Início da própria pessoa (M1–M4).

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const cert = (role: CertificadoLido["role"], em: string, aprovado = false): CertificadoLido => ({
  role,
  certifiedAt: em,
  aprovadoPeloAdmin: aprovado,
});

describe("uma medalha por função", () => {
  it("duas funções = duas medalhas; a reciclagem soma vezes na MESMA medalha", () => {
    const selos = selosDeCertificacao(
      [
        cert("receptionist", "2026-03-01T12:00:00Z"),
        cert("unit_manager", "2026-05-01T12:00:00Z", true),
        cert("receptionist", "2026-10-01T12:00:00Z"),
      ],
      ["receptionist", "unit_manager"]
    );
    expect(selos.map((s) => [s.role, s.vezes])).toEqual([
      ["receptionist", 2],
      ["unit_manager", 1],
    ]);
    const recepcao = selos[0];
    expect(recepcao.ultimaEm).toBe("2026-10-01T12:00:00Z");
    // A primeira é a certificação; as seguintes, reciclagem. Mais recente primeiro.
    expect(recepcao.historico.map((h) => h.tipo)).toEqual(["reciclagem", "certificacao"]);
    expect(selos[1].historico[0].aprovadoPeloAdmin).toBe(true);
  });

  it("M4: a função que ela não tem mais continua, marcada e depois das atuais", () => {
    const selos = selosDeCertificacao(
      [cert("receptionist", "2026-10-20T12:00:00Z"), cert("asb", "2026-01-01T12:00:00Z")],
      ["asb"]
    );
    expect(selos.map((s) => [s.role, s.atual])).toEqual([
      ["asb", true],
      ["receptionist", false],
    ]);
    expect(explicacaoDoSelo(selos[1])).toContain("não tem mais esta função");
    expect(explicacaoDoSelo(selos[0])).not.toContain("não tem mais");
  });

  it("a data sai no relógio brasileiro (certificado às 22h de Brasília não vira o dia seguinte)", () => {
    const [s] = selosDeCertificacao([cert("tsb", "2026-10-24T01:30:00Z")], ["tsb"]);
    expect(explicacaoDoSelo(s)).toContain("23/10/2026");
  });

  it("função que o sistema não conhece não vira medalha", () => {
    const selos = selosDeCertificacao(
      [{ role: "toString" as never, certifiedAt: "2026-10-01T12:00:00Z", aprovadoPeloAdmin: false }],
      []
    );
    expect(selos).toEqual([]);
  });
});

describe("o filtro Certificado em [função]", () => {
  const pessoa = (certificacoes: PessoaDaEquipe["certificacoes"]): PessoaDaEquipe => ({
    tipo: "risartano",
    chave: "1",
    href: "/risartanos/RIS-0001",
    code: "RIS-0001",
    nome: "Ana",
    funcaoPrevista: null,
    nomeCompleto: "Ana",
    email: null,
    cpf: null,
    fotoUrl: null,
    unidadeOrigem: null,
    unidadeOrigemId: null,
    unidades: [],
    regime: null,
    ativo: true,
    temAcesso: true,
    acessoAtivo: true,
    isAdminMaster: false,
    podeGerir: true,
    certificacoes,
  });

  it("acha quem pode cobrir — inclusive quem já foi certificado e mudou de função", () => {
    const f = lerFiltros({ certificado: "receptionist" }, []);
    expect(f.certificado).toBe("receptionist");
    const antiga = selosDeCertificacao([cert("receptionist", "2026-01-01T12:00:00Z")], ["asb"]);
    expect(passaNoFiltro(pessoa(antiga), f)).toBe(true);
    expect(passaNoFiltro(pessoa([]), f)).toBe(false);
    expect(certificadoEm(antiga, "asb")).toBe(false);
  });

  it("lixo no endereço vira 'qualquer um', nunca uma função inventada", () => {
    expect(lerFiltros({ certificado: "toString" }, []).certificado).toBe("");
    expect(lerFiltros({ certificado: "<script>" }, []).certificado).toBe("");
  });

  it("o filtro só oferece as funções que alguém da lista tem", () => {
    const a = selosDeCertificacao([cert("unit_manager", "2026-01-01T12:00:00Z")], []);
    const b = selosDeCertificacao([cert("asb", "2026-01-01T12:00:00Z")], []);
    expect(funcoesCertificadas([a, b, []])).toEqual(["asb", "unit_manager"]);
  });
});

describe("as telas leem a mesma regra", () => {
  it("a lista mostra a medalha e o filtro; leitura que falha avisa", () => {
    const pagina = ler("src/app/(app)/risartanos/page.tsx");
    expect(pagina).toMatch(/<MedalhasDeCertificacao/);
    expect(pagina).toMatch(/name="certificado"/);
    expect(pagina).toMatch(/certificacoesLidas/);
  });

  it("a ficha e o Início também", () => {
    expect(ler("src/app/(app)/risartanos/[codigo]/page.tsx")).toMatch(/<CertificacoesDaPessoa/);
    expect(ler("src/app/(app)/page.tsx")).toMatch(/<MinhasCertificacoes/);
  });
});
