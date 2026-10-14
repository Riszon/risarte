-- =============================================================================
-- 0291 — QUEM ESTÁ ONLINE (pedido do dono, 13/10/2026)
--
-- "Devo conseguir visualizar quem está online no sistema."
--
-- O sistema já sabia quem estava online — a bolinha do Chat —, mas só mostrava
-- isso dentro do Chat. O dono pediu um lugar para ver todo mundo de uma vez, e
-- decidiu (13/10/2026):
--
--   - ONDE: na barra de cima e na Auditoria;
--   - QUEM VÊ: só o Admin Master (a mesma regra da Auditoria);
--   - O QUE MOSTRA: a hora em que entrou, a última atividade, EM QUAL TELA a
--     pessoa está e quem ainda não entrou hoje.
--
-- Quase tudo já existia em `access_sessions` (0287): a hora da entrada e a
-- última atividade, que a tela manda no máximo uma vez por minuto. Esta
-- migração acrescenta UMA informação — a tela — e as duas consultas.
--
-- ⚠️ "A TELA" É O MÓDULO, NUNCA O ENDEREÇO. O endereço de um prontuário leva o
-- identificador do paciente; guardar "fulano está em /prontuarios/<id>" seria
-- registrar, numa coluna de presença, quem olha a ficha de quem — e isso já
-- tem lugar certo (a trilha de ações, com as regras dela). Aqui entra só
-- "prontuarios", "financeiro", "admin/auditoria". O BANCO recusa o que tiver
-- número ou letra maiúscula, mesmo que a tela mande: a regra não depende de o
-- navegador se comportar.
--
-- ⚠️ O QUE É "ONLINE", "AUSENTE" E "SAIU" — uma régua só, a deste arquivo:
--   - ONLINE: acesso de hoje, aberto, com atividade nos últimos 5 minutos;
--   - AUSENTE: acesso de hoje, aberto, parado há mais de 5 minutos e ainda
--     dentro do tempo de inatividade da função (depois dele o acesso já caiu,
--     mesmo que o sistema só registre a queda no próximo clique);
--   - SAIU: entrou hoje e não tem acesso aberto agora;
--   - NÃO ENTROU: tem acesso ativo e nenhum registro hoje.
-- Os 5 minutos são os mesmos do Chat e do "tempo em uso" da 0287.
--
-- Nenhuma tabela nova, nenhum dado alterado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Em qual tela a pessoa está
-- -----------------------------------------------------------------------------
alter table public.access_sessions
  add column if not exists current_screen text,
  add column if not exists screen_at timestamptz;

comment on column public.access_sessions.current_screen is
  '0291: o MÓDULO em que a pessoa está agora ("agenda", "admin/auditoria"). '
  'Nunca o endereço completo: sem identificador de paciente, sem código.';
comment on column public.access_sessions.screen_at is
  '0291: quando current_screen foi informado pela última vez.';

-- A tela avisa onde está. NÃO conta como atividade: abrir uma página não é
-- mexer no sistema, e quem decide o que é atividade continua sendo o
-- `access_session_touch`. Função À PARTE, e não um parâmetro novo no touch,
-- por causa do calendário: o código vai ao ar sozinho e a migração espera
-- alguém rodar. Se o sinal de atividade passasse a pedir um parâmetro que o
-- banco ainda não conhece, ele falharia — e todo mundo cairia por
-- inatividade trabalhando.
create or replace function public.access_session_screen(p_tela text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_uid uuid := (select auth.uid());
  v_tela text := btrim(coalesce(p_tela, ''));
begin
  if v_sid is null or v_uid is null then
    return;
  end if;
  -- Só minúsculas e hífen, no máximo dois pedaços. Qualquer outra coisa (um
  -- identificador, um código, um endereço inteiro) é IGNORADA — não gravada
  -- pela metade.
  if v_tela !~ '^[a-z][a-z-]{0,39}(/[a-z][a-z-]{0,39})?$' then
    return;
  end if;
  update public.access_sessions
     set current_screen = v_tela,
         screen_at = now()
   where auth_session_id = v_sid
     and user_id = v_uid
     and ended_at is null;
end;
$$;

revoke execute on function public.access_session_screen(text)
  from public, anon, authenticated;
grant execute on function public.access_session_screen(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) Quem está online, quem está ausente, quem saiu e quem não entrou
-- -----------------------------------------------------------------------------
-- Uma linha por pessoa com acesso ativo. `p_grupo = 'conectados'` devolve só
-- online e ausentes (é o que a barra de cima abre); nulo devolve todos.
--
-- SÓ O ADMIN MASTER: para qualquer outra pessoa a função devolve vazio — a
-- guarda está na primeira linha (`hoje`), de onde todo o resto depende.
drop function if exists public.presence_now(text);

create function public.presence_now(p_grupo text default null)
returns table (
  user_id uuid,
  full_name text,
  is_admin_master boolean,
  roles jsonb,
  status text,
  connected_since timestamptz,
  first_today_at timestamptz,
  last_activity_at timestamptz,
  left_at timestamptz,
  current_screen text,
  open_sessions integer,
  idle_limit_min integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with hoje as (
    select public.today_br() as dia
    where public.is_admin_master()
  ),
  quem as (
    select
      p.id,
      coalesce(nullif(btrim(p.full_name), ''), p.email, '—') as nome,
      p.is_admin_master,
      public.access_idle_limit(p.id) as limite
    from hoje
    cross join public.profiles p
    where p.is_active
  ),
  sess as (
    select
      a.user_id,
      a.started_at,
      a.last_activity_at,
      a.ended_at,
      a.end_reason,
      a.current_screen,
      a.screen_at,
      -- VIVA: aberta e dentro do tempo de inatividade (a mesma folga de dois
      -- minutos do `access_session_check`), ou protegida por uma gravação.
      (
        a.ended_at is null
        and (
          (a.protected_until is not null and a.protected_until > now())
          or now() - a.last_activity_at <= make_interval(mins => q.limite + 2)
        )
      ) as viva
    from quem q
    join public.access_sessions a on a.user_id = q.id
    cross join hoje h
    where a.access_day = h.dia
  ),
  por as (
    select
      s.user_id,
      (count(*) filter (where s.viva))::integer as abertas,
      min(s.started_at) as primeira,
      max(s.last_activity_at) as ultima,
      max(s.last_activity_at) filter (where s.viva) as ultima_viva,
      -- Até quando a pessoa esteve aqui: a saída, se clicou em Sair; senão a
      -- última atividade (a mesma regra do relatório, AP34).
      max(case when s.end_reason = 'saiu' then s.ended_at else s.last_activity_at end) as ate
    from sess s
    group by s.user_id
  ),
  atual as (
    -- O acesso vivo de atividade mais recente: é dele a "hora em que entrou".
    select distinct on (s.user_id)
      s.user_id, s.started_at
    from sess s
    where s.viva
    order by s.user_id, s.last_activity_at desc, s.started_at desc
  ),
  tela as (
    -- A tela é a INFORMADA POR ÚLTIMO entre os acessos vivos — não a do acesso
    -- de atividade mais recente. As duas coisas divergem logo depois de um
    -- login: o acesso novo já tem atividade e ainda não disse onde está, e a
    -- pessoa aparecia sem tela (visto no treino, na própria linha de quem
    -- olhava). Quem tem dois navegadores abertos aparece pela tela que abriu
    -- por último.
    select distinct on (s.user_id)
      s.user_id, s.current_screen
    from sess s
    where s.viva and s.current_screen is not null
    order by s.user_id, s.screen_at desc nulls last, s.last_activity_at desc
  ),
  linhas as (
    select
      q.id as user_id,
      q.nome as full_name,
      q.is_admin_master,
      coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object('c', r.clinic_id, 'n', c.name, 'r', r.role::text)
                   order by c.name, r.role::text
                 )
          from public.user_clinic_roles_all r
          left join public.clinics c on c.id = r.clinic_id
          where r.user_id = q.id
        ),
        '[]'::jsonb
      ) as roles,
      case
        when coalesce(p.abertas, 0) > 0
             and now() - p.ultima_viva <= interval '5 minutes' then 'online'
        when coalesce(p.abertas, 0) > 0 then 'ausente'
        when p.user_id is not null then 'saiu'
        else 'nao_entrou'
      end as status,
      a.started_at as connected_since,
      p.primeira as first_today_at,
      p.ultima as last_activity_at,
      case when coalesce(p.abertas, 0) = 0 then p.ate end as left_at,
      t.current_screen,
      coalesce(p.abertas, 0) as open_sessions,
      q.limite as idle_limit_min
    from quem q
    left join por p on p.user_id = q.id
    left join atual a on a.user_id = q.id
    left join tela t on t.user_id = q.id
  )
  select
    l.user_id,
    l.full_name,
    l.is_admin_master,
    l.roles,
    l.status,
    l.connected_since,
    l.first_today_at,
    l.last_activity_at,
    l.left_at,
    l.current_screen,
    l.open_sessions,
    l.idle_limit_min
  from linhas l
  where p_grupo is null
     or (p_grupo = 'conectados' and l.status in ('online', 'ausente'))
  -- Ordem ESTÁVEL (a API devolve em páginas de 1.000): grupo, nome, id.
  order by
    case l.status when 'online' then 0 when 'ausente' then 1 when 'saiu' then 2 else 3 end,
    lower(l.full_name),
    l.user_id;
$$;

revoke execute on function public.presence_now(text)
  from public, anon, authenticated;
grant execute on function public.presence_now(text) to authenticated;

comment on function public.presence_now(text) is
  '0291: quem está online, ausente, saiu ou não entrou hoje — uma linha por '
  'pessoa com acesso ativo. Só o Admin Master recebe linhas.';

-- O número da barra de cima. Consulta própria, e não a lista contada na tela:
-- a API corta em 1.000 linhas (AP35), e um contador que conta o que veio
-- passaria a mentir justamente quando a rede crescer.
create or replace function public.presence_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin_master() then (
      select jsonb_build_object(
        'online', count(*) filter (where p.status = 'online'),
        'ausentes', count(*) filter (where p.status = 'ausente'),
        'sairam', count(*) filter (where p.status = 'saiu'),
        'nao_entraram', count(*) filter (where p.status = 'nao_entrou')
      )
      from public.presence_now(null) p
    )
  end;
$$;

revoke execute on function public.presence_summary()
  from public, anon, authenticated;
grant execute on function public.presence_summary() to authenticated;

comment on function public.presence_summary() is
  '0291: quantos estão online, ausentes, saíram e não entraram hoje. Nulo para '
  'quem não é Admin Master.';

notify pgrst, 'reload schema';
