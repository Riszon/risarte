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
import { Turmas, type TurmaAberta } from "./turmas";

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
    { data: turmasBrutas },
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
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("training_campaigns")
      .select(
        "id, code, kind, note, created_at, clinics(name), training_enrollments(user_id, role, status, started_at, profiles(full_name))"
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

  const turmas: TurmaAberta[] = (turmasBrutas ?? []).map((t) => ({
    id: String(t.id),
    code: t.code ? String(t.code) : null,
    kind: String(t.kind),
    note: t.note ? String(t.note) : null,
    created_at: String(t.created_at),
    clinic_name: umNome(t.clinics) ?? "Unidade",
    matriculas: (t.training_enrollments ?? []).map((m) => ({
      user_id: String(m.user_id),
      full_name: umNome(m.profiles),
      role: String(m.role),
      status: m.status as TurmaAberta["matriculas"][number]["status"],
      started_at: m.started_at ? String(m.started_at) : null,
    })),
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
          unidades={(unidades ?? []).map((u) => ({
            id: String(u.id),
            name: String(u.name),
          }))}
          turmas={turmas}
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
