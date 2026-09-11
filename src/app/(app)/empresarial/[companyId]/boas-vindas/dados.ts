import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import { liberacaoDaPessoa, type Liberacao } from "@/lib/empresarial/carencia";
import { RELATIONSHIP_LABELS, type Relationship } from "@/lib/empresarial/constants";
import { VOLTAM_PARA_A_FILA } from "./constantes";

/**
 * A LISTA DE BOAS-VINDAS DE UMA EMPRESA (pedido do dono, 11/09/2026).
 *
 * Serve a recepção e a SDR: ligar para quem entrou no programa, dar as
 * boas-vindas, completar o cadastro e marcar a primeira consulta.
 *
 * ⚠️ UMA LINHA POR PESSOA, NÃO POR COLABORADOR. Quem liga fala com gente: o
 * titular e cada dependente têm nome, telefone e cadastro próprios. Uma lista
 * por colaborador com os dependentes escondidos numa coluna faria a recepção
 * esquecer metade das pessoas — que são justamente as que mais precisam de
 * cadastro, porque entraram de carona no do titular.
 *
 * ⚠️ MAS AGRUPADA POR FAMÍLIA, porque a ligação é uma só. Listar o dependente
 * longe do titular faria a mesma casa ser chamada duas vezes.
 */

export type PessoaParaContatar = {
  /** Identifica a pessoa para registrar o contato. Um dos dois é nulo. */
  employeeId: string | null;
  dependentId: string | null;
  nome: string;
  cpf: string;
  telefone: string | null;
  /** "Titular" ou o parentesco. */
  papel: string;
  titular: boolean;
  /** Cadastro completo no riSZon, ou ainda pré-cadastrado. */
  cadastroCompleto: boolean;
  /** Já tem ficha de cliente ligada — sem ela não há como agendar. */
  temFicha: boolean;
  unidade: string | null;
  liberacao: Liberacao;
  contato: {
    resultado: "CONTACTED" | "NO_ANSWER" | "CALL_LATER" | "DECLINED";
    em: string;
    por: string | null;
    nota: string | null;
  } | null;
};

export type FamiliaParaContatar = {
  employeeId: string;
  /** O titular vem primeiro; os dependentes em seguida. */
  pessoas: PessoaParaContatar[];
};

export type ProcedimentoComCarencia = {
  nome: string;
  meses: number;
};

export type ListaDeBoasVindas = {
  empresa: {
    id: string;
    nome: string;
    cnpj: string;
    status: string;
    contratoIniciadoEm: string | null;
    diasDaEmpresa: number;
    diasDoColaboradorPadrao: number;
  };
  familias: FamiliaParaContatar[];
  /**
   * Procedimentos com carência PRÓPRIA, em meses, contada da entrada da pessoa.
   * Ficam fora da data de cada um — ver o comentário em `carencia.ts`.
   */
  procedimentosComCarencia: ProcedimentoComCarencia[];
};

type EmployeeRow = {
  id: string;
  full_name: string;
  cpf: string;
  phone: string | null;
  status: string;
  registration_stage: "PRE_REGISTERED" | "COMPLETED";
  joined_at: string;
  left_at: string | null;
  grace_period_days: number | null;
  client_id: string | null;
  clinic_id: string | null;
  dependents: {
    id: string;
    full_name: string | null;
    cpf: string;
    phone: string | null;
    relationship: Relationship;
    status: string;
    client_id: string | null;
  }[] | null;
};

export async function carregarBoasVindas(
  companyId: string,
  hoje: Date
): Promise<ListaDeBoasVindas | null> {
  const db = await empresarialDb();

  const { data: empresa } = await db
    .from("companies")
    .select(
      "id, legal_name, trade_name, cnpj, status, contract_started_at, grace_period_days, employee_grace_period_days"
    )
    .eq("id", companyId)
    .maybeSingle<{
      id: string;
      legal_name: string;
      trade_name: string | null;
      cnpj: string;
      status: string;
      contract_started_at: string | null;
      grace_period_days: number | null;
      employee_grace_period_days: number | null;
    }>();
  if (!empresa) return null;

  const [
    { data: colaboradores },
    { data: contatos, error: erroDosContatos },
    { data: beneficios },
  ] = await Promise.all([
      db
        .from("employees")
        .select(
          "id, full_name, cpf, phone, status, registration_stage, joined_at, left_at, grace_period_days, client_id, clinic_id, dependents ( id, full_name, cpf, phone, relationship, status, client_id )"
        )
        .eq("company_id", companyId)
        // ⚠️ SÓ QUEM ESTÁ ATIVO. Quem saiu do programa não recebe boas-vindas —
        // e ligar para ex-colaborador oferecendo benefício que ele não tem mais
        // é pior que não ligar.
        .eq("status", "ACTIVE")
        .is("left_at", null)
        .order("full_name")
        .returns<EmployeeRow[]>(),
      // ⚠️ SEM `embed` DE `profiles`. As duas tabelas vivem em schemas
      // diferentes (`empresarial` e `public`) e o PostgREST não enxerga a
      // chave estrangeira entre elas: a consulta devolvia
      // "Could not find a relationship … in the schema cache". O nome de quem
      // ligou vem numa consulta à parte, logo abaixo.
      db
        .from("welcome_contacts")
        .select("employee_id, dependent_id, outcome, contacted_at, note, contacted_by")
        .eq("company_id", companyId)
        .returns<
          {
            employee_id: string | null;
            dependent_id: string | null;
            outcome: "CONTACTED" | "NO_ANSWER" | "CALL_LATER" | "DECLINED";
            contacted_at: string;
            note: string | null;
            contacted_by: string | null;
          }[]
        >(),
      // A carência por procedimento: a linha da EMPRESA quando existir, senão a
      // da rede — a mesma escolha que o motor de benefícios faz.
      db
        .from("procedure_benefits")
        .select("procedure_id, company_id, grace_period_months")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .gt("grace_period_months", 0)
        .returns<
          { procedure_id: string; company_id: string | null; grace_period_months: number }[]
        >(),
    ]);

  // ⚠️ ESTE ERRO NÃO PODE PASSAR CALADO, e passou: a primeira versão pegava só
  // o `data` e ignorava o `error`. A consulta falhava (embed entre schemas),
  // `contatos` vinha vazio, e a tela concluía que NINGUÉM tinha sido
  // contatado — mostrando a fila inteira de novo, todo dia, sem um sinal. A
  // recepção ligaria duas vezes para as mesmas pessoas e acharia que o sistema
  // é que estava certo. Falhar alto é a única saída honesta aqui.
  if (erroDosContatos) {
    throw new Error(
      `Não consegui ler os contatos já registrados (${erroDosContatos.message}). ` +
        `Sem eles a lista mostraria todo mundo como se ninguém tivesse sido chamado.`
    );
  }

  // ---- nomes das unidades e dos procedimentos, num lote --------------------
  // ⚠️ `empresarialDb()` já vem preso ao schema `empresarial` e não volta ao
  // `public` — clínicas e procedimentos precisam do cliente comum.
  const publico = await createClient();

  const clinicIds = [
    ...new Set((colaboradores ?? []).map((e) => e.clinic_id).filter(Boolean)),
  ] as string[];
  const { data: clinicas } = clinicIds.length
    ? await publico.from("clinics").select("id, name").in("id", clinicIds)
    : { data: [] as { id: string; name: string }[] };
  const nomeDaUnidade = new Map(
    (clinicas ?? []).map((c) => [c.id, c.name as string])
  );

  const escolhidos = new Map<string, number>();
  for (const b of beneficios ?? []) {
    const atual = escolhidos.get(b.procedure_id);
    // A da empresa ganha da rede; sem a da empresa, vale a da rede.
    if (atual === undefined || b.company_id === companyId) {
      escolhidos.set(b.procedure_id, b.grace_period_months);
    }
  }
  const { data: procedimentos } = escolhidos.size
    ? await publico.from("procedures").select("id, name").in("id", [...escolhidos.keys()])
    : { data: [] as { id: string; name: string }[] };

  const procedimentosComCarencia: ProcedimentoComCarencia[] = (procedimentos ?? [])
    .map((p) => ({
      nome: p.name as string,
      meses: escolhidos.get(p.id as string) ?? 0,
    }))
    .sort((a, b) => b.meses - a.meses || a.nome.localeCompare(b.nome));

  // ---- contatos já registrados --------------------------------------------
  // Quem ligou vem do schema `public`, numa consulta só para todos os nomes.
  const quemLigou = [
    ...new Set((contatos ?? []).map((c) => c.contacted_by).filter(Boolean)),
  ] as string[];
  const { data: pessoas } = quemLigou.length
    ? await publico.from("profiles").select("id, full_name").in("id", quemLigou)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nomeDeQuemLigou = new Map(
    (pessoas ?? []).map((p) => [p.id as string, (p.full_name as string) ?? null])
  );

  const contatoDe = new Map<string, PessoaParaContatar["contato"]>();
  for (const c of contatos ?? []) {
    const chave = c.employee_id ? `e:${c.employee_id}` : `d:${c.dependent_id}`;
    contatoDe.set(chave, {
      resultado: c.outcome,
      em: c.contacted_at,
      por: c.contacted_by ? (nomeDeQuemLigou.get(c.contacted_by) ?? null) : null,
      nota: c.note,
    });
  }

  const entradaBase = {
    contratoIniciadoEm: empresa.contract_started_at,
    diasDaEmpresa: empresa.grace_period_days ?? 0,
    diasDoColaboradorPadrao: empresa.employee_grace_period_days ?? 0,
  };

  const familias: FamiliaParaContatar[] = (colaboradores ?? []).map((e) => {
    const liberacaoDoTitular = liberacaoDaPessoa(
      {
        ...entradaBase,
        diasDesteColaborador: e.grace_period_days,
        entrouEm: e.joined_at,
      },
      hoje
    );

    const titular: PessoaParaContatar = {
      employeeId: e.id,
      dependentId: null,
      nome: e.full_name,
      cpf: e.cpf,
      telefone: e.phone,
      papel: "Titular",
      titular: true,
      cadastroCompleto: e.registration_stage === "COMPLETED",
      temFicha: !!e.client_id,
      unidade: e.clinic_id ? (nomeDaUnidade.get(e.clinic_id) ?? null) : null,
      liberacao: liberacaoDoTitular,
      contato: contatoDe.get(`e:${e.id}`) ?? null,
    };

    const dependentes: PessoaParaContatar[] = (e.dependents ?? [])
      .filter((d) => d.status === "ACTIVE")
      .map((d) => ({
        employeeId: null,
        dependentId: d.id,
        nome: d.full_name || "(sem nome no cadastro)",
        cpf: d.cpf,
        // ⚠️ SEM TELEFONE PRÓPRIO, VALE O DO TITULAR — e a tela diz de quem é.
        // Deixar a coluna vazia faria a recepção pular o dependente por não ter
        // para onde ligar, quando o caminho é ligar para a casa.
        telefone: d.phone || e.phone,
        papel: RELATIONSHIP_LABELS[d.relationship] ?? "Dependente",
        titular: false,
        cadastroCompleto: !!d.full_name && !!d.client_id,
        temFicha: !!d.client_id,
        unidade: e.clinic_id ? (nomeDaUnidade.get(e.clinic_id) ?? null) : null,
        // ⚠️ O DEPENDENTE HERDA A CARÊNCIA DO TITULAR, porque a entrada dele no
        // programa é a entrada da família. É o que o motor de benefícios já faz.
        liberacao: liberacaoDoTitular,
        contato: contatoDe.get(`d:${d.id}`) ?? null,
      }));

    return { employeeId: e.id, pessoas: [titular, ...dependentes] };
  });

  return {
    empresa: {
      id: empresa.id,
      nome: empresa.trade_name || empresa.legal_name,
      cnpj: empresa.cnpj,
      status: empresa.status,
      contratoIniciadoEm: empresa.contract_started_at,
      diasDaEmpresa: entradaBase.diasDaEmpresa,
      diasDoColaboradorPadrao: entradaBase.diasDoColaboradorPadrao,
    },
    familias,
    procedimentosComCarencia,
  };
}

/**
 * Ainda precisa de ligação?
 *
 * ⚠️ "JÁ LIGUEI" NÃO É O MESMO QUE "RESOLVIDO". Quem não atendeu e quem pediu
 * para ligar depois continuam na fila — tirá-los faria a lista esvaziar com o
 * trabalho por fazer, que é o jeito mais silencioso de um controle falhar.
 */
export function precisaDeContato(p: PessoaParaContatar): boolean {
  if (!p.contato) return true;
  return VOLTAM_PARA_A_FILA.includes(p.contato.resultado);
}
