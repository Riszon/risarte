-- =============================================================================
-- 0276 — A TRANCA DO SISTEMA REAL PASSA A SER POR UNIDADE E FUNÇÃO
--        (portão de certificação, Etapa 3 — parte 1)
-- -----------------------------------------------------------------------------
-- Até aqui a tranca era POR PESSOA (0259): o sistema real estava aberto ou
-- fechado para fulano, em todas as unidades de uma vez. A regra do dono
-- (26/09/2026) é outra:
--
--   *"o acesso vai ser liberado na unidade com a função que ela cumpriu a
--   missão. Se ela tem funções iguais em unidades diferentes, basta ela
--   cumprir a missão 1 vez que estará liberada nas outras unidades,
--   respeitando o acesso em grupo quando for o caso coletivo da unidade (...)
--   Mas se ela tiver funções diferentes deve cumprir a missão completa em cada
--   função."* E: *"vai liberar somente a da função que finalizou, não fica
--   travado para finalizar a missão das duas funções."*
--
-- Uma pessoa tem UMA função por unidade (`user_clinic_roles` é único por
-- pessoa + unidade), então "unidade + função" é uma linha de
-- `user_clinic_roles`, e é para cada uma delas que esta migração responde
-- ABERTA ou FECHADA — e por quê.
--
-- ⚠️ A PORTA DA 0259 CONTINUA, POR CIMA. O interruptor "Sistema" na ficha do
-- Risartano fecha TODAS as unidades da pessoa. Aberto, ele não abre nada
-- sozinho: cada unidade ainda precisa de um motivo para estar aberta.
--
-- ⚠️ QUEM JÁ TRABALHA CONTINUA TRABALHANDO. Cada (pessoa, unidade, função)
-- que já existe para quem tem a porta registrada vira "liberado antes do
-- portão". Sem isso, a equipe inteira cairia no modo portal no minuto em que
-- a migração rodasse. A regra nova vale para o que MUDAR daqui em diante:
-- função nova numa unidade, pessoa nova.
--
-- ⚠️ ONDE A TRANCA FICA: no caminho por onde toda tela passa
-- (`getSessionContext`), igual à 0259 — NÃO na RLS. Quem chamasse o banco
-- direto, sem passar pelas telas, ainda leria o que a função dele permite.
-- Registrado no BACKLOG (AP14) para ser corrigido em seguida, por decisão do
-- dono.
--
-- Nada é LIBERADO automaticamente nesta migração: a gravação do certificado
-- é a parte 2. A regra abaixo já sabe ler o certificado, para a parte 2 só
-- precisar gravá-lo.
--
-- Idempotente. Não apaga nada.
-- =============================================================================

-- 1) As liberações que NÃO vêm de certificado ---------------------------------
--   anterior — já trabalhava quando o portão passou a valer por unidade;
--   manual   — o Admin liberou sem missão, com motivo.
create table if not exists public.system_clinic_access (
  user_id uuid not null references public.profiles (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  role public.user_role not null,
  source text not null check (source in ('anterior', 'manual')),
  note text,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id),
  -- Retirar NÃO apaga a linha (ordem do dono, 25/09/2026: nada se apaga sem
  -- alguém pedir): marca quando e quem. Liberar de novo limpa a marca.
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  primary key (user_id, clinic_id, role),
  -- Liberação manual sem motivo é a que ninguém sabe explicar seis meses
  -- depois. O banco exige — a tela sozinha não bastaria.
  check (source <> 'manual' or length(btrim(coalesce(note, ''))) > 0)
);

-- ⚠️ A FUNÇÃO FAZ PARTE DA CHAVE, de propósito. Se a recepcionista liberada
-- em Cambé virar gerente em Cambé, a linha antiga (recepção) deixa de valer
-- para ela lá — gerência é outra missão. É exatamente a regra do dono.

comment on table public.system_clinic_access is
  'Liberações do sistema real por (pessoa, unidade, função) que não vêm de certificado: anterior ao portão ou manual do Admin (0276).';

alter table public.system_clinic_access enable row level security;

drop policy if exists system_clinic_access_select on public.system_clinic_access;
create policy system_clinic_access_select on public.system_clinic_access
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_master()
    or exists (
      select 1 from public.staff_members s
       where s.user_id = system_clinic_access.user_id
         and public.can_see_staff(s.clinic_id, s.user_id)
    )
  );
-- Sem policy de escrita: só pelas funções abaixo, que têm a guarda.

-- 2) Quem já trabalha: "liberado antes do portão" -----------------------------
-- Quem tem a porta da 0259 REGISTRADA (aberta, ou fechada por alguém — inclusive
-- a suspensão da reciclagem) já passou pelo sistema real. Quem NÃO tem linha é
-- Risartano novo, em modo portal: esse fica de fora, e é para ele que o portão
-- existe.
--
-- ⚠️ SÓ RODA COM A TABELA VAZIA. Rodar esta migração de novo daqui a um mês
-- carimbaria "anterior ao portão" em gente que chegou depois — a porta de
-- entrada do portão viraria a saída. Tabela com qualquer linha = o registro
-- inicial já foi feito.
do $$
begin
  if not exists (select 1 from public.system_clinic_access) then
    insert into public.system_clinic_access (user_id, clinic_id, role, source)
    select ucr.user_id, ucr.clinic_id, ucr.role, 'anterior'
      from public.user_clinic_roles ucr
     where exists (
             select 1 from public.user_environments ue
              where ue.user_id = ucr.user_id and ue.environment = 'sistema'
           )
        or exists (
             select 1 from public.profiles p
              where p.id = ucr.user_id and p.is_admin_master
           )
    on conflict do nothing;
  end if;
end $$;

-- 3) A REGRA: cada unidade da pessoa, aberta ou fechada, e por quê ------------
-- Uma função só responde para a tela da sessão, para a ficha do Risartano e
-- para o Início — três cópias da regra divergiriam na primeira mudança.
--
-- A ordem é a da pergunta "o que abre esta unidade?":
--   1. Admin Master           → aberta (nunca se tranca para fora — 0259);
--   2. porta fechada na ficha → FECHADA em todas (resposta 2 do dono);
--   3. liberação registrada   → aberta (anterior ou manual);
--   4. função sem metas       → aberta (meta em branco não barra ninguém —
--                                0271; é assim que a produção está hoje);
--   5. certificado da FUNÇÃO  → aberta, em QUALQUER unidade onde ela tenha
--                                essa função ("basta cumprir 1 vez") — salvo
--                                se a unidade está numa turma COLETIVA de
--                                novatos com gente que ainda não cumpriu;
--   6. senão                  → FECHADA, aguardando a missão.
drop function if exists public.system_access_by_clinic(uuid);
create or replace function public.system_access_by_clinic(p_user_id uuid)
returns table (clinic_id uuid, role public.user_role, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_porta boolean;
  v_coletiva boolean;
begin
  -- ⚠️ `is distinct from`, nunca `<>` (AP9): sem sessão, `auth.uid()` é nulo
  -- e `<>` deixaria passar.
  if p_user_id is distinct from auth.uid()
     and not public.is_admin_master()
     and not exists (
       select 1 from public.staff_members s
        where s.user_id = p_user_id
          and public.can_see_staff(s.clinic_id, s.user_id)
     ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(p.is_admin_master, false) into v_admin
    from public.profiles p where p.id = p_user_id;
  v_porta := public.environment_allowed(p_user_id, 'sistema');
  select (ts.release_scope = 'coletiva') into v_coletiva
    from public.training_settings ts;

  return query
  select
    ucr.clinic_id,
    ucr.role,
    case
      when coalesce(v_admin, false) then true
      when not v_porta then false
      when sca.user_id is not null then true
      when not exists (select 1 from public.training_requirements tr where tr.role = ucr.role) then true
      when cert.ok and not grupo.pendente then true
      else false
    end,
    case
      when coalesce(v_admin, false) then 'admin_master'
      when not v_porta then 'sistema_fechado'
      when sca.user_id is not null then sca.source
      when not exists (select 1 from public.training_requirements tr where tr.role = ucr.role) then 'sem_metas'
      when cert.ok and grupo.pendente then 'aguardando_grupo'
      when cert.ok then 'certificado'
      else 'aguardando_missao'
    end
  from public.user_clinic_roles ucr
  left join public.system_clinic_access sca
         on sca.user_id = ucr.user_id
        and sca.clinic_id = ucr.clinic_id
        and sca.role = ucr.role
        and sca.revoked_at is null
  cross join lateral (
    select exists (
      select 1 from public.training_certifications c
       where c.user_id = ucr.user_id and c.role = ucr.role
    ) as ok
  ) cert
  -- COLETIVA: a unidade só abre quando TODO o grupo de novatos dela cumpriu.
  -- "Cumpriu" = tem certificado da função da matrícula DEPOIS da convocação
  -- (um certificado antigo não prova a turma de agora).
  cross join lateral (
    select coalesce(v_coletiva, false) and exists (
      select 1
        from public.training_enrollments e
        join public.training_campaigns tc on tc.id = e.campaign_id
       where e.clinic_id = ucr.clinic_id
         and tc.status = 'aberta'
         and tc.kind = 'novatos'
         and e.status <> 'dispensado'
         and not exists (
           select 1 from public.training_certifications c2
            where c2.user_id = e.user_id
              and c2.role = e.role
              and c2.certified_at >= e.invited_at
         )
    ) as pendente
  ) grupo
  where ucr.user_id = p_user_id;
end;
$$;

revoke all on function public.system_access_by_clinic(uuid) from public;
grant execute on function public.system_access_by_clinic(uuid) to authenticated;

comment on function public.system_access_by_clinic(uuid) is
  'Para cada (unidade, função) da pessoa: o sistema real está aberto ali, e por quê. A régua única da tranca por unidade (0276).';

-- 4) LIBERAR SEM MISSÃO — só o Admin Master, e com motivo ---------------------
-- A saída para o caso que a régua não prevê (profissional experiente vindo de
-- outra rede). Sem ela, a única saída seria apagar as metas da função para a
-- REDE inteira.
drop function if exists public.grant_clinic_access(uuid, uuid, text);
create or replace function public.grant_clinic_access(
  p_user_id uuid,
  p_clinic_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'NOTE_REQUIRED';
  end if;

  -- A função vem do cadastro, não da tela: liberar "recepção" para quem é
  -- gerente ali criaria uma linha que nunca vale — e pareceria liberado.
  select ucr.role into v_role
    from public.user_clinic_roles ucr
   where ucr.user_id = p_user_id and ucr.clinic_id = p_clinic_id;
  if v_role is null then
    raise exception 'NO_ROLE_IN_CLINIC';
  end if;

  insert into public.system_clinic_access
    (user_id, clinic_id, role, source, note, granted_by)
  values (p_user_id, p_clinic_id, v_role, 'manual', btrim(p_note), auth.uid())
  on conflict (user_id, clinic_id, role) do update
    set source = 'manual',
        note = excluded.note,
        granted_at = now(),
        granted_by = excluded.granted_by,
        revoked_at = null,
        revoked_by = null;
end;
$$;

revoke all on function public.grant_clinic_access(uuid, uuid, text) from public;
grant execute on function public.grant_clinic_access(uuid, uuid, text) to authenticated;

-- 5) RETIRAR A LIBERAÇÃO — marca, não apaga ----------------------------------
-- Vale para a manual E para a "anterior": o Admin pode querer que alguém que
-- já trabalhava faça a missão. Certificado não se retira aqui — é fato
-- histórico (0273).
drop function if exists public.revoke_clinic_access(uuid, uuid);
create or replace function public.revoke_clinic_access(
  p_user_id uuid,
  p_clinic_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.system_clinic_access
     set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id
     and clinic_id = p_clinic_id
     and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.revoke_clinic_access(uuid, uuid) from public;
grant execute on function public.revoke_clinic_access(uuid, uuid) to authenticated;
