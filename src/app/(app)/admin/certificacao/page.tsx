import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PADRAO_DO_PORTAO,
  cargosElegiveis,
  ehEscopo,
  ehGatilho,
  ehModoDeGrupo,
  type ConfiguracaoDoPortao,
  type MetaDoTreino,
  type ParticipanteDoGrupo,
} from "@/lib/certificacao";
import { PortaoEditor } from "./portao-editor";
import { MissoesEditor } from "./missoes-editor";
import {
  Turmas,
  type MatriculaNaTurma,
  type TurmaAberta,
  type UnidadeParaTurma,
} from "./turmas";

export const metadata: Metadata = { title: "Certificação para o sistema real" };

type PerfilLinha = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export default async function CertificacaoPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const [
    { data: metas },
    { data: config },
    { data: cargosDoGrupo },
    { data: pessoasDoGrupo },
    { data: perfis },
    { data: unidades },
    { data: turmasBrutas, error: erroDasTurmas },
  ] = await Promise.all([
    supabase
      .from("training_requirements")
      .select("role, indicator, minimum_count")
      .returns<MetaDoTreino[]>(),
    supabase
      .from("training_settings")
      .select("release_scope, release_trigger, cohort_mode")
      .maybeSingle(),
    supabase.from("training_cohort_roles").select("role"),
    supabase.from("training_cohort_members").select("user_id"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name")
      .returns<PerfilLinha[]>(),
    supabase
      .from("clinics")
      .select("id, name, type")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("training_campaigns")
      .select(
        "id, code, kind, note, created_at, access_policy, deadline, whole_network, training_campaign_units(clinic_id), training_enrollments(user_id, role, status, started_at, access_suspended_at, clinic_id, profiles(full_name))"
      )
      .eq("status", "aberta")
      .order("created_at", { ascending: false }),
  ]);

  // ⚠️ Linha ausente ou valor estranho cai no PADRÃO, e o padrão é o cauteloso
  // (individual + aprovação). A tela nunca fica sem resposta — e, se a migração
  // ainda não rodou naquele banco, ela mostra o padrão em vez de quebrar
  // (mesma janela tratada em `permission_matrix`, §0b do CLAUDE.md).
  const atual: ConfiguracaoDoPortao = {
    release_scope:
      config && ehEscopo(String(config.release_scope))
        ? (config.release_scope as ConfiguracaoDoPortao["release_scope"])
        : PADRAO_DO_PORTAO.release_scope,
    release_trigger:
      config && ehGatilho(String(config.release_trigger))
        ? (config.release_trigger as ConfiguracaoDoPortao["release_trigger"])
        : PADRAO_DO_PORTAO.release_trigger,
    cohort_mode:
      config && ehModoDeGrupo(String(config.cohort_mode))
        ? (config.cohort_mode as ConfiguracaoDoPortao["cohort_mode"])
        : PADRAO_DO_PORTAO.cohort_mode,
  };

  const listaDeMetas = metas ?? [];
  const pessoas: ParticipanteDoGrupo[] = (perfis ?? []).map((p) => ({
    user_id: p.id,
    full_name: p.full_name,
    email: p.email,
  }));

  // O Supabase devolve o que foi embutido como objeto OU lista, conforme a
  // relação. Normalizo aqui, uma vez, em vez de espalhar `?.[0]` pela tela.
  const umNome = (v: unknown): string | null => {
    if (!v) return null;
    const o = Array.isArray(v) ? v[0] : v;
    return (o as { name?: string; full_name?: string })?.name ??
      (o as { full_name?: string })?.full_name ??
      null;
  };

  // ⚠️ O NOME DA UNIDADE VEM DA LISTA DE CLÍNICAS JÁ CARREGADA, não de um
  // embed na turma. Com a 0275, turma → clínica tem dois caminhos (a coluna
  // antiga e a lista de unidades) e o embed ficaria ambíguo — a mesma armadilha
  // que já derrubou listas inteiras (ver "Lições" em ARQUITETURA-TECNICA.md).
  const nomeDe = new Map((unidades ?? []).map((u) => [String(u.id), String(u.name)]));

  const turmas: TurmaAberta[] = (turmasBrutas ?? []).map((t) => {
    const matriculas = (t.training_enrollments ?? []).map((m) => ({
      user_id: String(m.user_id),
      full_name: umNome(m.profiles),
      role: String(m.role),
      status: m.status as MatriculaNaTurma["status"],
      started_at: m.started_at ? String(m.started_at) : null,
      access_suspended_at: m.access_suspended_at
        ? String(m.access_suspended_at)
        : null,
      clinic_id: m.clinic_id ? String(m.clinic_id) : null,
    }));
    const idsDasUnidades = (t.training_campaign_units ?? []).map((u) =>
      String(u.clinic_id)
    );
    return {
      id: String(t.id),
      code: t.code ? String(t.code) : null,
      kind: String(t.kind),
      note: t.note ? String(t.note) : null,
      created_at: String(t.created_at),
      access_policy: String(t.access_policy ?? "mantem"),
      deadline: t.deadline ? String(t.deadline) : null,
      whole_network: Boolean(t.whole_network),
      // O PROGRESSO NÃO É MEDIDO AQUI. Uma turma da rede toda pode ter milhares
      // de pessoas; medir todas ao abrir a tela travaria a tela. Cada unidade é
      // medida quando o Admin a abre (`medirUnidadeDaTurma`).
      unidades: idsDasUnidades
        .map((id) => ({
          id,
          name: nomeDe.get(id) ?? "Unidade desativada",
          matriculas: matriculas.filter((m) => m.clinic_id === id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    };
  });

  // Unidade que já está numa turma aberta não pode entrar em outra (0275).
  const turmaDaUnidade = new Map<string, string>();
  for (const t of turmas) {
    for (const u of t.unidades) turmaDaUnidade.set(u.id, t.code ?? "aberta");
  }
  const unidadesParaTurma: UnidadeParaTurma[] = (unidades ?? []).map((u) => ({
    id: String(u.id),
    name: String(u.name),
    franqueadora: u.type === "franchisor",
    turmaAberta: turmaDaUnidade.get(String(u.id)) ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Certificação para o sistema real
        </h1>
        <p className="text-sm text-muted-foreground">
          O riSZon real já nasce <strong>fechado</strong> para todo Risartano
          novo: ele entra primeiro no treino. Aqui se define o que cada função
          precisa cumprir no treino para que o sistema real seja liberado.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Vale para a rede inteira.</p>
        <p className="mt-1 text-muted-foreground">
          Não há ajuste por unidade, de propósito: é o padrão único de entrada
          no sistema real. Unidade que pudesse baixar a própria régua
          transformaria o portão em sugestão.
        </p>
      </div>

      <PortaoEditor
        atual={atual}
        cargosElegiveis={cargosElegiveis(listaDeMetas)}
        pessoas={pessoas}
        cargosNoGrupo={(cargosDoGrupo ?? []).map((r) => String(r.role))}
        pessoasNoGrupo={(pessoasDoGrupo ?? []).map((r) => String(r.user_id))}
      />

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            A missão de cada função
          </h2>
          <p className="text-sm text-muted-foreground">
            Quantas vezes a pessoa precisa fazer cada coisa <strong>no
            treino</strong>. Função sem nenhum número exigido não é barrada. As
            funções já configuradas abrem sozinhas; as demais abrem no clique.
          </p>
        </div>
        <MissoesEditor metas={listaDeMetas} />
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Turmas de treinamento
          </h2>
          <p className="text-sm text-muted-foreground">
            A missão <strong>não fica valendo o tempo todo</strong>. A pessoa
            usa o treino livremente para aprender; só quando é convocada — e
            aceita — o que ela faz passa a contar para a certificação.
          </p>
        </div>
        <Turmas
          unidades={unidadesParaTurma}
          turmas={turmas}
          // ⚠️ ERRO AO LER NÃO É "NENHUMA TURMA". Na janela entre o código ir
          // ao ar e a 0275 ser rodada no banco, esta consulta falha — e a tela
          // diria "nenhuma turma aberta" com turmas abertas lá. É a régua vazia
          // respondendo "não" (§0d do CLAUDE.md).
          erroAoLer={
            erroDasTurmas
              ? "Não foi possível ler as turmas. Se a atualização 0275 ainda não foi aplicada neste banco, é isso: rode-a e recarregue."
              : null
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        A medição do progresso e a liberação automática entram nas próximas
        etapas. Por enquanto esta tela guarda a definição, e a liberação
        continua sendo feita à mão em Administração → Ambientes.
      </p>
    </div>
  );
}
