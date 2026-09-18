import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTreino } from "@/lib/environment";
import { STAFF_PHOTO_BUCKET } from "@/lib/staff";
import { acharNoTreino, clienteDoTreino, treinoConfigurado } from "@/lib/treino";
import {
  AMBIENTES_DO_ESPELHO,
  ambientesNoTreino,
  falhaSemDados,
  linhaDoRisartanoNoTreino,
  loginAbertoNoTreino,
  niveisDeCarreiraDoTreino,
  nivelPreservado,
  permitidoNaProducao,
  type LinhaDeAmbiente,
} from "@/lib/espelho";

/**
 * O TREINO É ESPELHO DA PRODUÇÃO (0260) — quem lê de um banco e grava no outro.
 *
 * Decisão do dono (18/09/2026): Risartanos, logins, funções, ambientes e
 * permissões nascem e mudam SÓ na produção. Cada ação que mexe nisso aqui
 * agenda a cópia daquela pessoa inteira no treino (`agendarEspelho…`), e o
 * botão "Sincronizar treino agora" (/admin/ambientes) copia tudo de uma vez.
 *
 * Por que copiar a pessoa INTEIRA e não só o campo que mudou: a cópia se
 * conserta sozinha. Se uma falhou, a próxima alteração daquela pessoa leva
 * tudo de novo — e o botão leva todo mundo.
 *
 * A PONTE entre os bancos:
 *   - pessoa: pelo E-MAIL, gravado em `mirror_user_map` no treino (o login
 *     novo nasce com o mesmo id da produção; os antigos têm id próprio);
 *   - unidade: pelo CÓDIGO (FRA, CAM…), depois pelo nome; a que não existe lá
 *     é criada com o mesmo id da produção;
 *   - ficha, histórico e agenda do Risartano: o MESMO id nos dois bancos.
 *
 * ⚠️ A cópia NUNCA derruba a ação da produção. Ela roda depois da resposta
 * (`after`), e a falha vira "pendente" em `mirror_state` — a tela avisa o Admin
 * e o botão resolve. Mensagem guardada = passo + código, nunca o texto do banco
 * (que repete valores, CPF inclusive).
 */

export type ResultadoDoEspelho = {
  ok: boolean;
  error?: string;
  avisos: string[];
  resumo?: { pessoas: number; risartanos: number; permissoes: number };
};

type Ctx = {
  prod: SupabaseClient;
  treino: SupabaseClient;
  /** id da unidade na produção → id no treino (null = não deu para casar). */
  unidades: Map<string, string | null>;
  /** id da pessoa na produção → id no treino. */
  pessoas: Map<string, string | null>;
  pessoasFeitas: Set<string>;
  avisos: string[];
};

class FalhaDoEspelho extends Error {}

function exigir<T>(
  resposta: { data: T; error: { code?: string | null } | null },
  passo: string
): T {
  if (resposta.error) {
    throw new FalhaDoEspelho(falhaSemDados(passo, resposta.error.code));
  }
  return resposta.data;
}

/**
 * Só a PRODUÇÃO copia, e só com o treino configurado. A trava da URL impede o
 * pior engano possível: uma configuração trocada fazendo o banco copiar para
 * si mesmo.
 */
function abrir(): Ctx | null {
  if (isTreino() || !treinoConfigurado()) return null;
  const urlTreino = (process.env.TREINO_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const urlProd = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!urlTreino || urlTreino === urlProd) return null;
  const treino = clienteDoTreino();
  if (!treino) return null;
  let prod: SupabaseClient;
  try {
    prod = createAdminClient();
  } catch {
    return null;
  }
  return {
    prod,
    treino,
    unidades: new Map(),
    pessoas: new Map(),
    pessoasFeitas: new Set(),
    avisos: [],
  };
}

// -----------------------------------------------------------------------------
// Pontes
// -----------------------------------------------------------------------------

type Unidade = {
  id: string;
  code: string | null;
  name: string;
  type: string;
  ownership: string | null;
  is_active: boolean;
  city: string | null;
  state: string | null;
};

async function carregarPonteDasUnidades(ctx: Ctx): Promise<void> {
  if (ctx.unidades.size > 0) return;
  const colunas = "id, code, name, type, ownership, is_active, city, state";
  const [prod, treino] = await Promise.all([
    ctx.prod.from("clinics").select(colunas).returns<Unidade[]>(),
    ctx.treino.from("clinics").select(colunas).returns<Unidade[]>(),
  ]);
  const deProd = exigir(prod, "ler as unidades da produção") ?? [];
  const deTreino = exigir(treino, "ler as unidades do treino") ?? [];

  const porCodigo = new Map(
    deTreino.filter((c) => c.code).map((c) => [c.code!.toUpperCase(), c.id])
  );
  const porNome = new Map(deTreino.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const porId = new Set(deTreino.map((c) => c.id));

  for (const c of deProd) {
    const local =
      (c.code && porCodigo.get(c.code.toUpperCase())) ||
      porNome.get(c.name.trim().toLowerCase()) ||
      (porId.has(c.id) ? c.id : null);
    if (local) {
      ctx.unidades.set(c.id, local);
      continue;
    }
    // A unidade não existe no treino: nasce lá com o mesmo id e o mesmo
    // código. Sem ela, quem trabalha nela chegaria ao treino sem função.
    const { error } = await ctx.treino.from("clinics").insert({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      ownership: c.ownership,
      is_active: c.is_active,
      city: c.city,
      state: c.state,
    });
    if (error) {
      ctx.unidades.set(c.id, null);
      ctx.avisos.push(falhaSemDados(`criar a unidade ${c.code ?? c.name} no treino`, error.code));
    } else {
      ctx.unidades.set(c.id, c.id);
    }
  }
}

async function carregarPonteDasPessoas(ctx: Ctx): Promise<void> {
  const mapa = exigir(
    await ctx.treino
      .from("mirror_user_map")
      .select("source_id, local_id")
      .returns<{ source_id: string; local_id: string }[]>(),
    "ler a ponte das pessoas no treino (a migração 0260 rodou lá?)"
  );
  for (const m of mapa ?? []) ctx.pessoas.set(m.source_id, m.local_id);
}

type Perfil = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  is_admin_master: boolean;
};

/** Garante o login da pessoa no treino e devolve o id de lá. */
async function garantirLogin(ctx: Ctx, perfil: Perfil): Promise<string | null> {
  const conhecido = ctx.pessoas.get(perfil.id);
  if (conhecido) return conhecido;
  if (!perfil.email) {
    ctx.avisos.push("uma pessoa sem e-mail ficou fora do treino");
    ctx.pessoas.set(perfil.id, null);
    return null;
  }

  let local = (await acharNoTreino(ctx.treino, perfil.email))?.id ?? null;
  if (!local) {
    // Senha sorteada e descartada: ninguém a conhece. A pessoa passa a entrar
    // no treino quando a senha for definida na produção ("Redefinir senha" na
    // ficha, ou "Minha senha" no Perfil) — as duas copiam para cá.
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const senha = Buffer.from(bytes).toString("base64url");
    const { data, error } = await ctx.treino.auth.admin.createUser({
      id: perfil.id,
      email: perfil.email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: perfil.full_name },
    });
    if (error || !data.user) {
      ctx.avisos.push(falhaSemDados("criar um login no treino", error?.code));
      ctx.pessoas.set(perfil.id, null);
      return null;
    }
    local = data.user.id;
  }

  exigir(
    await ctx.treino
      .from("mirror_user_map")
      .upsert(
        { source_id: perfil.id, local_id: local, synced_at: new Date().toISOString() },
        { onConflict: "source_id" }
      ),
    "gravar a ponte da pessoa no treino"
  );
  ctx.pessoas.set(perfil.id, local);
  return local;
}

// -----------------------------------------------------------------------------
// A pessoa (login, funções, escopo, ambientes)
// -----------------------------------------------------------------------------

async function espelharPessoaCtx(ctx: Ctx, idProd: string): Promise<string | null> {
  if (ctx.pessoasFeitas.has(idProd)) return ctx.pessoas.get(idProd) ?? null;
  ctx.pessoasFeitas.add(idProd);

  const perfil = exigir(
    await ctx.prod
      .from("profiles")
      .select("id, full_name, phone, email, is_active, is_admin_master")
      .eq("id", idProd)
      .maybeSingle<Perfil>(),
    "ler o perfil na produção"
  );
  if (!perfil) return null;

  const local = await garantirLogin(ctx, perfil);
  if (!local) return null;

  const [funcoesRes, ambientesRes] = await Promise.all([
    ctx.prod
      .from("user_clinic_roles")
      .select("clinic_id, role, unit_scope, role_unit_access ( clinic_id )")
      .eq("user_id", idProd)
      .returns<
        {
          clinic_id: string;
          role: string;
          unit_scope: string | null;
          role_unit_access: { clinic_id: string }[] | null;
        }[]
      >(),
    ctx.prod
      .from("user_environments")
      .select("environment, allowed")
      .eq("user_id", idProd)
      .returns<LinhaDeAmbiente[]>(),
  ]);
  const funcoes = exigir(funcoesRes, "ler as funções na produção") ?? [];
  const ambientes = exigir(ambientesRes, "ler os ambientes na produção") ?? [];

  // O perfil: nome, telefone, situação e Admin Master vêm daqui.
  exigir(
    await ctx.treino
      .from("profiles")
      .update({
        full_name: perfil.full_name,
        phone: perfil.phone,
        is_active: perfil.is_active,
        is_admin_master: perfil.is_admin_master,
      })
      .eq("id", local),
    "atualizar o perfil no treino"
  );

  // O login: aberto só para quem está ativo e liberado no treino.
  const aberto = loginAbertoNoTreino({
    ativo: perfil.is_active,
    isAdminMaster: perfil.is_admin_master,
    linhas: ambientes,
  });
  const { error: erroBan } = await ctx.treino.auth.admin.updateUserById(local, {
    ban_duration: aberto ? "none" : "876000h",
  });
  if (erroBan) {
    throw new FalhaDoEspelho(falhaSemDados("abrir/fechar o login no treino", erroBan.code));
  }

  // As funções: o conjunto de lá passa a ser EXATAMENTE o daqui — menos o
  // nível de carreira do dentista, que é do treino (0261) e é preservado.
  await carregarPonteDasUnidades(ctx);
  const niveis = niveisDeCarreiraDoTreino(
    exigir(
      await ctx.treino
        .from("user_clinic_roles")
        .select("clinic_id, role, career_level_id")
        .eq("user_id", local)
        .returns<{ clinic_id: string; role: string; career_level_id: string | null }[]>(),
      "ler os níveis de carreira no treino"
    ) ?? []
  );
  exigir(
    await ctx.treino.from("user_clinic_roles").delete().eq("user_id", local),
    "limpar as funções antigas no treino"
  );
  for (const f of funcoes) {
    const unidade = ctx.unidades.get(f.clinic_id);
    if (!unidade) {
      ctx.avisos.push("uma função ficou fora do treino: a unidade não existe lá");
      continue;
    }
    const linha = exigir(
      await ctx.treino
        .from("user_clinic_roles")
        .insert({
          user_id: local,
          clinic_id: unidade,
          role: f.role,
          unit_scope: f.unit_scope,
          career_level_id: nivelPreservado(niveis, unidade, f.role),
        })
        .select("id")
        .single<{ id: string }>(),
      "gravar uma função no treino"
    );
    if (!linha) throw new FalhaDoEspelho("gravar uma função no treino (sem retorno)");
    const escopo = (f.role_unit_access ?? [])
      .map((r) => ctx.unidades.get(r.clinic_id))
      .filter((id): id is string => Boolean(id));
    if (escopo.length > 0) {
      exigir(
        await ctx.treino
          .from("role_unit_access")
          .insert(escopo.map((clinic_id) => ({ user_clinic_role_id: linha.id, clinic_id }))),
        "gravar o escopo de unidades no treino"
      );
    }
  }

  // Os ambientes, como o treino precisa enxergá-los — e, guardados na ponte,
  // como estão na produção (é o que a ficha de lá mostra).
  exigir(
    await ctx.treino
      .from("mirror_user_map")
      .update({
        source_environments: Object.fromEntries(
          AMBIENTES_DO_ESPELHO.map((a) => [
            a,
            permitidoNaProducao(perfil.is_admin_master, ambientes, a),
          ])
        ),
      })
      .eq("source_id", idProd),
    "gravar os ambientes da produção no treino"
  );
  const noTreino = ambientesNoTreino(perfil.is_admin_master, ambientes);
  exigir(
    await ctx.treino.from("user_environments").upsert(
      AMBIENTES_DO_ESPELHO.map((environment) => ({
        user_id: local,
        environment,
        allowed: noTreino[environment],
      })),
      { onConflict: "user_id,environment" }
    ),
    "gravar os ambientes no treino"
  );

  return local;
}

// -----------------------------------------------------------------------------
// O Risartano (ficha, foto, histórico, dias de atendimento)
// -----------------------------------------------------------------------------

async function espelharRisartanoCtx(ctx: Ctx, staffId: string): Promise<void> {
  const linha = exigir(
    await ctx.prod
      .from("staff_members")
      .select("*")
      .eq("id", staffId)
      .maybeSingle<Record<string, unknown>>(),
    "ler a ficha na produção"
  );
  if (!linha) return;

  if (linha.user_id) await espelharPessoaCtx(ctx, linha.user_id as string);
  await carregarPonteDasUnidades(ctx);

  const unidadeLocal = ctx.unidades.get(linha.clinic_id as string);
  if (!unidadeLocal) {
    ctx.avisos.push("uma ficha ficou fora do treino: a unidade dela não existe lá");
    return;
  }

  const { linha: noTreino, unidadesFaltando } = linhaDoRisartanoNoTreino(linha, {
    unidadeLocal,
    unidades: ctx.unidades,
    pessoas: ctx.pessoas,
    agora: new Date().toISOString(),
  });
  if (unidadesFaltando.length > 0) {
    ctx.avisos.push("uma unidade inativa de uma ficha não existe no treino");
  }

  // A foto: copia o arquivo só quando o caminho mudou.
  const foto = linha.photo_path as string | null;
  if (foto) {
    const atual = exigir(
      await ctx.treino
        .from("staff_members")
        .select("photo_path")
        .eq("id", staffId)
        .maybeSingle<{ photo_path: string | null }>(),
      "ler a ficha no treino"
    );
    if (atual?.photo_path !== noTreino.photo_path) {
      const baixado = await ctx.prod.storage.from(STAFF_PHOTO_BUCKET).download(foto);
      if (baixado.error || !baixado.data) {
        ctx.avisos.push("a foto de uma ficha não foi copiada");
        noTreino.photo_path = atual?.photo_path ?? null;
      } else {
        const { error } = await ctx.treino.storage
          .from(STAFF_PHOTO_BUCKET)
          .upload(noTreino.photo_path as string, baixado.data, {
            upsert: true,
            contentType: baixado.data.type || undefined,
          });
        if (error) {
          ctx.avisos.push("a foto de uma ficha não foi copiada");
          noTreino.photo_path = atual?.photo_path ?? null;
        }
      }
    }
  }

  exigir(
    await ctx.treino.from("staff_members").upsert(noTreino, { onConflict: "id" }),
    "gravar a ficha no treino"
  );

  // Histórico de alterações: mesmo id, autor traduzido.
  const historico = exigir(
    await ctx.prod
      .from("staff_member_changes")
      .select("id, staff_member_id, changed_at, changed_by, fields")
      .eq("staff_member_id", staffId)
      .returns<
        {
          id: string;
          staff_member_id: string;
          changed_at: string;
          changed_by: string | null;
          fields: unknown;
        }[]
      >(),
    "ler o histórico na produção"
  );
  if (historico && historico.length > 0) {
    exigir(
      await ctx.treino.from("staff_member_changes").upsert(
        historico.map((h) => ({
          ...h,
          changed_by: h.changed_by ? ctx.pessoas.get(h.changed_by) ?? null : null,
        })),
        { onConflict: "id" }
      ),
      "gravar o histórico no treino"
    );
  }

  // Dias de atendimento: o conjunto de lá passa a ser o daqui.
  const agendas = exigir(
    await ctx.prod
      .from("staff_clinic_schedule")
      .select("id, clinic_id, weekdays, specific_dates, note, updated_at")
      .eq("staff_member_id", staffId)
      .returns<
        {
          id: string;
          clinic_id: string;
          weekdays: number[];
          specific_dates: string[];
          note: string | null;
          updated_at: string;
        }[]
      >(),
    "ler os dias de atendimento na produção"
  );
  exigir(
    await ctx.treino.from("staff_clinic_schedule").delete().eq("staff_member_id", staffId),
    "limpar os dias de atendimento no treino"
  );
  const agendasNoTreino = (agendas ?? [])
    .map((a) => ({ ...a, staff_member_id: staffId, clinic_id: ctx.unidades.get(a.clinic_id) }))
    .filter((a): a is typeof a & { clinic_id: string } => Boolean(a.clinic_id));
  if (agendasNoTreino.length > 0) {
    exigir(
      await ctx.treino.from("staff_clinic_schedule").insert(agendasNoTreino),
      "gravar os dias de atendimento no treino"
    );
  }
}

// -----------------------------------------------------------------------------
// Permissões
// -----------------------------------------------------------------------------

async function espelharPermissoesCtx(ctx: Ctx): Promise<number> {
  const linhas = exigir(
    await ctx.prod
      .from("permission_matrix")
      .select("capability, role, allowed, updated_at")
      .returns<{ capability: string; role: string; allowed: boolean; updated_at: string }[]>(),
    "ler a matriz de permissões na produção"
  );
  exigir(
    await ctx.treino.from("permission_matrix").delete().neq("capability", ""),
    "limpar a matriz de permissões no treino"
  );
  if (linhas && linhas.length > 0) {
    exigir(
      await ctx.treino
        .from("permission_matrix")
        .insert(linhas.map((l) => ({ ...l, updated_by: null }))),
      "gravar a matriz de permissões no treino"
    );
  }
  return linhas?.length ?? 0;
}

// -----------------------------------------------------------------------------
// Registro do resultado (nos dois bancos)
// -----------------------------------------------------------------------------

async function registrar(
  ctx: Ctx,
  resultado: { ok: boolean; erro?: string; completo?: boolean; resumo?: unknown }
): Promise<void> {
  const agora = new Date().toISOString();
  // No treino: liga a trava (is_mirror) e diz quando foi a última cópia.
  const noTreino: Record<string, unknown> = { id: true, is_mirror: true };
  if (resultado.ok) noTreino.last_sync_at = agora;
  if (resultado.ok && resultado.completo) {
    noTreino.last_full_sync_at = agora;
    noTreino.summary = resultado.resumo ?? null;
  }
  const { error: e1 } = await ctx.treino
    .from("mirror_state")
    .upsert(noTreino, { onConflict: "id" });
  if (e1) console.error("espelho: registrar no treino falhou:", e1.code);

  // Na produção: pendente até uma cópia completa dar certo.
  const naProducao: Record<string, unknown> = { id: true };
  if (resultado.ok) {
    naProducao.last_sync_at = agora;
    if (resultado.completo) {
      naProducao.last_full_sync_at = agora;
      naProducao.pending = false;
      naProducao.last_error = null;
      naProducao.summary = resultado.resumo ?? null;
    }
  } else {
    naProducao.pending = true;
    naProducao.last_error = resultado.erro ?? "falha sem detalhe";
    naProducao.last_error_at = agora;
  }
  const { error: e2 } = await ctx.prod
    .from("mirror_state")
    .upsert(naProducao, { onConflict: "id" });
  if (e2) console.error("espelho: registrar na produção falhou:", e2.code);
}

async function executar(
  trabalho: (ctx: Ctx) => Promise<ResultadoDoEspelho["resumo"] | void>,
  completo = false
): Promise<ResultadoDoEspelho> {
  const ctx = abrir();
  if (!ctx) {
    return {
      ok: false,
      error: isTreino()
        ? "O treino não copia: ele é a cópia."
        : "O treino não está configurado neste servidor.",
      avisos: [],
    };
  }
  try {
    await carregarPonteDasPessoas(ctx);
    const resumo = (await trabalho(ctx)) ?? undefined;
    await registrar(ctx, { ok: true, completo, resumo });
    return { ok: true, avisos: ctx.avisos, resumo };
  } catch (e) {
    const erro =
      e instanceof FalhaDoEspelho ? e.message : "erro inesperado ao copiar para o treino";
    if (!(e instanceof FalhaDoEspelho)) {
      console.error("espelho: erro inesperado", e instanceof Error ? e.name : typeof e);
    }
    await registrar(ctx, { ok: false, erro });
    return { ok: false, error: erro, avisos: ctx.avisos };
  }
}

// -----------------------------------------------------------------------------
// Portas de entrada
// -----------------------------------------------------------------------------

/** Copia UM Risartano inteiro (e o login dele, se tiver). */
export function espelharRisartano(staffId: string): Promise<ResultadoDoEspelho> {
  return executar((ctx) => espelharRisartanoCtx(ctx, staffId));
}

/** Copia UMA pessoa (login, funções, ambientes) e a ficha ligada a ela. */
export function espelharPessoa(userId: string): Promise<ResultadoDoEspelho> {
  return executar(async (ctx) => {
    await espelharPessoaCtx(ctx, userId);
    const fichas = exigir(
      await ctx.prod
        .from("staff_members")
        .select("id")
        .eq("user_id", userId)
        .returns<{ id: string }[]>(),
      "ler a ficha ligada ao login"
    );
    for (const f of fichas ?? []) await espelharRisartanoCtx(ctx, f.id);
  });
}

export function espelharPermissoes(): Promise<ResultadoDoEspelho> {
  return executar(async (ctx) => {
    await espelharPermissoesCtx(ctx);
  });
}

/** Tudo de uma vez: permissões, todas as pessoas e todas as fichas. */
export function espelharTudo(): Promise<ResultadoDoEspelho> {
  return executar(async (ctx) => {
    const permissoes = await espelharPermissoesCtx(ctx);
    await carregarPonteDasUnidades(ctx);
    const perfis = exigir(
      await ctx.prod.from("profiles").select("id").returns<{ id: string }[]>(),
      "listar as pessoas da produção"
    );
    for (const p of perfis ?? []) await espelharPessoaCtx(ctx, p.id);
    const fichas = exigir(
      await ctx.prod.from("staff_members").select("id").returns<{ id: string }[]>(),
      "listar os Risartanos da produção"
    );
    for (const f of fichas ?? []) await espelharRisartanoCtx(ctx, f.id);
    return {
      pessoas: perfis?.length ?? 0,
      risartanos: fichas?.length ?? 0,
      permissoes,
    };
  }, true);
}

/**
 * Agenda a cópia para DEPOIS da resposta: quem salvou não espera o outro banco,
 * e uma falha lá nunca desfaz o que foi salvo aqui. Fora da produção (ou sem o
 * treino configurado) não faz nada.
 */
export function agendarEspelho(
  alvo: { risartano: string } | { pessoa: string } | { permissoes: true }
): void {
  if (isTreino() || !treinoConfigurado()) return;
  after(async () => {
    if ("risartano" in alvo) await espelharRisartano(alvo.risartano);
    else if ("pessoa" in alvo) await espelharPessoa(alvo.pessoa);
    else await espelharPermissoes();
  });
}
