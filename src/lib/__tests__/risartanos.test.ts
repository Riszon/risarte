import { describe, expect, it } from "vitest";
import {
  ACESSO_ROTULO,
  CAMPOS_DO_CADASTRO,
  cadastroCompleto,
  casaBusca,
  chaveDaFicha,
  faltaNoCadastro,
  pedeEspecialidades,
  senhaSugerida,
  contarEquipe,
  enderecoDaFicha,
  lerFiltros,
  ordenar,
  passaNoFiltro,
  precisaDeAtencao,
  situacaoDeAcesso,
  type FiltrosDaEquipe,
  type PessoaDaEquipe,
} from "@/lib/risartanos";

const CONTRATOS = ["clt", "pj", "intern", "freelancer", "other"] as const;

function pessoa(over: Partial<PessoaDaEquipe> = {}): PessoaDaEquipe {
  return {
    tipo: "risartano",
    chave: "1",
    href: "/risartanos/RIS-0001",
    code: "RIS-0001",
    nome: "Ana",
    nomeCompleto: "Ana Maria Souza",
    email: "ana@risarte.com",
    cpf: "111.222.333-44",
    fotoUrl: null,
    unidadeOrigem: "Cambé",
    unidadeOrigemId: "cambe",
    unidades: [
      {
        clinicId: "cambe",
        clinicName: "Cambé",
        roleLabel: "Recepcionista",
        inativo: false,
        gerida: true,
      },
    ],
    regime: "clt",
    ativo: true,
    temAcesso: true,
    acessoAtivo: true,
    isAdminMaster: false,
    podeGerir: true,
    ...over,
  };
}

describe("situação do acesso", () => {
  it("cadastro com login liberado", () => {
    expect(situacaoDeAcesso(pessoa())).toBe("com_acesso");
  });

  it("cadastro sem login", () => {
    expect(situacaoDeAcesso(pessoa({ temAcesso: false, acessoAtivo: false }))).toBe(
      "sem_acesso"
    );
  });

  it("login bloqueado", () => {
    expect(situacaoDeAcesso(pessoa({ acessoAtivo: false }))).toBe(
      "acesso_desativado"
    );
  });

  it("⚠️ saiu da equipe e o login continua ativo — este é o caso de risco", () => {
    expect(situacaoDeAcesso(pessoa({ ativo: false }))).toBe("login_orfao");
    expect(ACESSO_ROTULO.login_orfao).toBe("Login ainda ativo");
  });

  it("colaborador inativo com o login já bloqueado não é risco", () => {
    expect(situacaoDeAcesso(pessoa({ ativo: false, acessoAtivo: false }))).toBe(
      "acesso_desativado"
    );
  });

  it("login sem cadastro de RH", () => {
    expect(situacaoDeAcesso(pessoa({ tipo: "login" }))).toBe(
      "cadastro_incompleto"
    );
  });
});

describe("busca", () => {
  const p = pessoa();

  it("acha por apelido, nome completo, e-mail, CPF e código", () => {
    for (const termo of ["ana", "souza", "ana@", "111.222", "ris-0001"]) {
      expect(casaBusca(p, termo)).toBe(true);
    }
  });

  it("ignora acento e maiúscula", () => {
    expect(casaBusca(pessoa({ nome: "Antônio" }), "antonio")).toBe(true);
  });

  it("busca vazia não filtra nada", () => {
    expect(casaBusca(p, "   ")).toBe(true);
  });

  it("não inventa: termo que não existe não casa", () => {
    expect(casaBusca(p, "joão")).toBe(false);
  });
});

describe("filtros da lista", () => {
  const padrao = lerFiltros({}, CONTRATOS);

  it("sem nada no endereço: ativos, todo mundo", () => {
    expect(padrao).toEqual({
      busca: "",
      unidade: "",
      contrato: "",
      situacao: "ativos",
      acesso: "",
    });
  });

  it("lixo no endereço cai no padrão em vez de derrubar a tela", () => {
    const f = lerFiltros(
      { situacao: "<script>", acesso: "sempre", contrato: "xpto" },
      CONTRATOS
    );
    expect(f.situacao).toBe("ativos");
    expect(f.acesso).toBe("");
    expect(f.contrato).toBe("");
  });

  it("o filtro de unidade olha a unidade de origem E as unidades do acesso", () => {
    const f: FiltrosDaEquipe = { ...padrao, unidade: "londrina" };
    expect(passaNoFiltro(pessoa(), f)).toBe(false);
    const multi = pessoa({
      unidades: [
        {
          clinicId: "londrina",
          clinicName: "Londrina",
          roleLabel: "Dentista",
          inativo: false,
          gerida: false,
        },
      ],
    });
    expect(passaNoFiltro(multi, f)).toBe(true);
  });

  it("inativos mostra só cadastro desligado — login sem cadastro não entra", () => {
    const f: FiltrosDaEquipe = { ...padrao, situacao: "inativos" };
    expect(passaNoFiltro(pessoa({ ativo: false }), f)).toBe(true);
    expect(passaNoFiltro(pessoa(), f)).toBe(false);
    expect(passaNoFiltro(pessoa({ tipo: "login" }), f)).toBe(false);
  });

  it("o login sem cadastro aparece na lista normal (não some do 'ativos')", () => {
    expect(passaNoFiltro(pessoa({ tipo: "login" }), padrao)).toBe(true);
  });

  it("'precisa de atenção' junta login órfão e cadastro incompleto", () => {
    const f: FiltrosDaEquipe = { ...padrao, situacao: "todos", acesso: "atencao" };
    expect(passaNoFiltro(pessoa({ ativo: false }), f)).toBe(true);
    expect(passaNoFiltro(pessoa({ tipo: "login" }), f)).toBe(true);
    expect(passaNoFiltro(pessoa(), f)).toBe(false);
  });
});

describe("contadores e ordem", () => {
  const lista = [
    pessoa({ chave: "a", nome: "Ana" }),
    pessoa({ chave: "b", nome: "Bruno", temAcesso: false, acessoAtivo: false }),
    pessoa({ chave: "c", nome: "Carla", ativo: false }),
    pessoa({ chave: "d", nome: "Davi", tipo: "login" }),
  ];

  it("conta cada situação uma vez só", () => {
    expect(contarEquipe(lista)).toEqual({
      total: 4,
      comAcesso: 1,
      semAcesso: 1,
      atencao: 2,
      inativos: 1,
    });
  });

  it("lista vazia não quebra", () => {
    expect(contarEquipe([]).total).toBe(0);
  });

  it("risco no topo, equipe no meio, pendência no fim", () => {
    // Carla = login de quem saiu (risco); Davi = login sem cadastro (tarefa).
    expect(ordenar(lista).map((p) => p.nome)).toEqual([
      "Carla",
      "Ana",
      "Bruno",
      "Davi",
    ]);
    expect(precisaDeAtencao(lista[0])).toBe(false);
  });
});

describe("função prevista e especialidades", () => {
  it("só dentista abre as especialidades", () => {
    expect(pedeEspecialidades("dentist")).toBe(true);
    expect(pedeEspecialidades("planner_dentist")).toBe(true);
    for (const outro of ["receptionist", "unit_manager", "tsb", "", null]) {
      expect(pedeEspecialidades(outro)).toBe(false);
    }
  });
});

describe("cadastro completo (o que libera a aba do Acesso)", () => {
  const completo = {
    fullName: "Ana Souza",
    preferredName: "Ana",
    cpf: "111.222.333-44",
    birthDate: "1990-01-01",
    gender: "female",
    maritalStatus: "single",
    whatsapp: "(43) 99999-0000",
    email: "ana@risarte.com",
    zipCode: "86000-000",
    address: "Rua A",
    addressNumber: "10",
    neighborhood: "Centro",
    city: "Londrina",
    state: "PR",
    contractType: "clt",
    roleTitle: "receptionist",
  };

  it("cadastro cheio libera", () => {
    expect(cadastroCompleto(completo)).toBe(true);
    expect(faltaNoCadastro(completo)).toEqual([]);
  });

  it("diz o que falta, com o nome que está na tela", () => {
    expect(faltaNoCadastro({ ...completo, roleTitle: null })).toEqual([
      "Função na unidade",
    ]);
    expect(faltaNoCadastro({ ...completo, cpf: "   ", city: "" })).toEqual([
      "CPF",
      "Cidade",
    ]);
  });

  it("⚠️ cadastro antigo, sem os campos novos, NÃO passa por ausência", () => {
    expect(cadastroCompleto({ fullName: "Só o nome" })).toBe(false);
    expect(faltaNoCadastro({}).length).toBe(CAMPOS_DO_CADASTRO.length);
  });
});

describe("senha provisória sugerida", () => {
  const bytes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("sai no formato combinado e não sorteia nada sozinha", () => {
    const senha = senhaSugerida(bytes);
    expect(senha).toBe(senhaSugerida(bytes));
    expect(senha).toHaveLength(10);
    expect(senha).toMatch(/^[a-z]{3}[2-9]{4}[a-z]{3}$/);
  });

  it("atende a regra do sistema: 6+, com letra e número", () => {
    for (let i = 0; i < 50; i++) {
      const s = senhaSugerida(Array.from({ length: 10 }, (_, k) => (i * 7 + k * 13) % 256));
      expect(s.length).toBeGreaterThanOrEqual(6);
      expect(/[a-zA-Z]/.test(s)).toBe(true);
      expect(/[0-9]/.test(s)).toBe(true);
    }
  });

  it("⚠️ sem 0/O e 1/l — senha ditada por telefone vira chamado", () => {
    for (let i = 0; i < 256; i++) {
      expect(senhaSugerida(Array(10).fill(i))).not.toMatch(/[0o1li]/);
    }
  });

  it("bytes faltando não derrubam (cai no primeiro caractere)", () => {
    expect(senhaSugerida([]).length).toBe(10);
  });
});

describe("endereço da ficha", () => {
  it("prefere o código", () => {
    expect(enderecoDaFicha({ code: "RIS-0007", id: "x" })).toBe(
      "/risartanos/RIS-0007"
    );
  });

  it("cadastro sem código abre pelo id", () => {
    const id = "0f8f2b0e-1c2d-4e5a-9b7c-1234567890ab";
    expect(enderecoDaFicha({ code: null, id })).toBe(`/risartanos/${id}`);
  });

  it("o endereço diz COMO procurar no banco", () => {
    expect(chaveDaFicha("ris-0007")).toEqual({ por: "code", valor: "RIS-0007" });
    expect(chaveDaFicha("0f8f2b0e-1c2d-4e5a-9b7c-1234567890ab")).toEqual({
      por: "id",
      valor: "0f8f2b0e-1c2d-4e5a-9b7c-1234567890ab",
    });
  });

  it("⚠️ lixo no endereço não vira consulta: 404 antes do banco", () => {
    for (const v of ["", "ris-", "'; drop table", "../admin"]) {
      expect(chaveDaFicha(v)).toBeNull();
    }
  });
});
