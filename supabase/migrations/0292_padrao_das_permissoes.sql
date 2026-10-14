-- =============================================================================
-- 0292 — O PADRÃO DAS PERMISSÕES PASSA A SER DO DONO (relato OC-00002, 14/10/2026)
--
-- "Quando faz uma alteração nas permissões aparece a sinalização 'Fora do
-- Padrão'; deve ter um botão para tornar padrão aquela alteração."
--
-- Até aqui, o "padrão" de cada permissão era o de FÁBRICA, escrito no código
-- (`src/lib/permissions.ts`): o comportamento de antes da matriz existir. Toda
-- decisão do dono aparecia para sempre com o selo "fora do padrão", e o botão
-- "voltar ao padrão" desfaria a decisão. Na produção, em 14/10/2026, 13 das 27
-- permissões estavam assim — todas por escolha dele.
--
-- Decisão do dono (14/10/2026): um botão "Tornar padrão" grava o padrão NO
-- BANCO. Daí em diante o selo compara com o padrão fixado, e "voltar ao padrão"
-- volta para ele. O de fábrica continua no código, para a permissão que nunca
-- teve padrão fixado — e como último recurso.
--
-- UMA LINHA POR PERMISSÃO, com a lista de funções. Não uma linha por função:
-- "padrão fixado com nenhuma função" (só o Admin) tem de existir e ser
-- diferente de "padrão nunca fixado" — e por linhas soltas os dois seriam a
-- mesma ausência.
--
-- Nada apaga: não existe porta de exclusão. Trocar o padrão é UPDATE.
-- Idempotente.
-- =============================================================================

create table if not exists public.permission_defaults (
  capability text primary key,
  roles public.user_role[] not null default '{}'::public.user_role[],
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.permission_defaults is
  '0292: o PADRÃO de cada permissão, fixado pelo Admin Master em /admin/permissoes ("Tornar padrão"). Sem linha, vale o padrão de fábrica do código. É a referência do selo "fora do padrão" e o destino do "voltar ao padrão"; quem pode o quê continua sendo a permission_matrix.';

alter table public.permission_defaults enable row level security;

-- Leitura e escrita só do Admin Master: ninguém mais abre a tela de permissões,
-- e o padrão não decide acesso de ninguém (quem decide é a permission_matrix).
drop policy if exists "permission_defaults_select" on public.permission_defaults;
create policy "permission_defaults_select" on public.permission_defaults
  for select to authenticated using (public.is_admin_master());

-- Sem política de escrita: só as duas funções abaixo gravam.

-- NO TREINO, O PADRÃO É CÓPIA DA PRODUÇÃO, como a matriz (0260): quem está
-- logado não grava; só a cópia (chave de serviço) escreve. Mesma trava, mesma
-- função — nos dois bancos o gatilho existe, e só age onde `is_mirror_db()`.
-- Visto testando no treino em 14/10/2026: sem ela, o "Tornar padrão" gravava
-- lá enquanto a matriz era recusada.
drop trigger if exists mirror_read_only on public.permission_defaults;
create trigger mirror_read_only
  before insert or update or delete on public.permission_defaults
  for each row execute function public.block_mirror_writes();

-- -----------------------------------------------------------------------------
-- "Tornar padrão": o que está VALENDO agora vira o padrão.
-- -----------------------------------------------------------------------------
-- Copia da permission_matrix, no banco, e não o que a tela mandou: o padrão
-- tem de ser o que está gravado, nunca um rascunho que ainda não foi salvo.
-- Várias de uma vez ("Tornar tudo padrão") numa transação só.
create or replace function public.fix_permission_defaults(p_capabilities text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_n integer;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_capabilities is null or array_length(p_capabilities, 1) is null then
    raise exception 'CAPABILITY_REQUIRED';
  end if;

  insert into public.permission_defaults (capability, roles, updated_by, updated_at)
  select c.cap,
         coalesce(
           (select array_agg(m.role order by m.role)
              from public.permission_matrix m
             where m.capability = c.cap and m.allowed),
           '{}'::public.user_role[]
         ),
         v_user,
         now()
    from (select distinct btrim(x) as cap from unnest(p_capabilities) as x) c
   where c.cap <> ''
  on conflict (capability) do update
     set roles = excluded.roles,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.fix_permission_defaults(text[])
  from public, anon, authenticated;
grant execute on function public.fix_permission_defaults(text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Um padrão escolhido por extenso — usado para voltar a usar o ORIGINAL DE
-- FÁBRICA como padrão (a tela manda a lista do código). UPDATE, nunca DELETE.
-- -----------------------------------------------------------------------------
create or replace function public.set_permission_default(
  p_capability text,
  p_roles public.user_role[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_capability is null or btrim(p_capability) = '' then
    raise exception 'CAPABILITY_REQUIRED';
  end if;

  insert into public.permission_defaults (capability, roles, updated_by, updated_at)
  values (
    btrim(p_capability),
    coalesce(
      (select array_agg(distinct r order by r) from unnest(p_roles) as r),
      '{}'::public.user_role[]
    ),
    (select auth.uid()),
    now()
  )
  on conflict (capability) do update
     set roles = excluded.roles,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.set_permission_default(text, public.user_role[])
  from public, anon, authenticated;
grant execute on function public.set_permission_default(text, public.user_role[]) to authenticated;

-- Tabela nova entra na trilha de alterações (regra 7 do CLAUDE.md, 0288).
select public.audit_attach_all();

notify pgrst, 'reload schema';
