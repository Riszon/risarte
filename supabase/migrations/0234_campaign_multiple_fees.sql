-- =============================================================================
-- 0234 — Campanha vale para VÁRIAS taxas
-- -----------------------------------------------------------------------------
-- Pedido do dono: a campanha precisa poder valer para todas as taxas, para uma,
-- ou para um conjunto escolhido. Na 0233 a coluna era uma taxa só (`fee`), com
-- nulo significando "todas" — não havia meio-termo, e o meio-termo é o caso
-- comum: "campanha de abertura: royalty e fundo pela metade, o resto normal".
--
-- `fees text[]`, com NULO (ou vazio) = todas. A alternativa seria uma tabela de
-- ligação; para uma lista curta que só é lida junto com a campanha, ela cobraria
-- um join em cada consulta do resolvedor sem devolver nada em troca.
--
-- CAMPANHA DE TAXAS ESCOLHIDAS GANHA DA CAMPANHA "TODAS". Mesma régua de sempre:
-- o mais específico vence. Sem isso, uma campanha geral da rede apagaria a
-- campanha dirigida a uma taxa, e o desempate seria a data — que não tem nada a
-- ver com quem deveria mandar.
--
-- A COLUNA ANTIGA SAI, e com ela a chave estrangeira que apagava a campanha
-- junto com a taxa. Em troca, `delete_network_fee_type` passa a RECUSAR quando
-- existe campanha usando a taxa. É o oposto de apagar em silêncio: tirar a taxa
-- da lista de uma campanha a esvaziaria, e vazia significa TODAS — a campanha
-- de uma taxa viraria campanha de todas sem ninguém pedir.
-- Idempotente.
-- =============================================================================

alter table public.network_fee_campaigns
  add column if not exists fees text[];

-- Traz o que existia da coluna antiga (uma taxa vira lista de uma).
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'network_fee_campaigns'
       and column_name = 'fee'
  ) then
    update public.network_fee_campaigns
       set fees = array[fee]
     where fee is not null and fees is null;

    alter table public.network_fee_campaigns drop column fee;
  end if;
end;
$$;

comment on column public.network_fee_campaigns.fees is
  'Taxas alcançadas pela campanha. NULO ou vazio = todas. Lista sem chave '
  'estrangeira de propósito: `delete_network_fee_type` recusa apagar taxa que '
  'esteja em campanha, porque esvaziar a lista transformaria a campanha de uma '
  'taxa em campanha de todas.';

create index if not exists network_fee_campaigns_fees_idx
  on public.network_fee_campaigns using gin (fees);

-- -----------------------------------------------------------------------------
-- O resolvedor, agora com lista
-- -----------------------------------------------------------------------------
-- Retorno igual ao da 0233: `create or replace` basta.
create or replace function public.network_fee_for(
  p_clinic_id uuid,
  p_fee text,
  p_on date default null
)
returns table (
  kind text,
  percent numeric,
  amount_cents bigint,
  due_day integer,
  active boolean,
  is_override boolean,
  note text,
  campaign_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with dia as (select coalesce(p_on, public.today_br()) as d),
  base as (
    select f.kind, f.percent, f.amount_cents, f.due_day, f.active,
           f.clinic_id is not null as is_override, f.note
    from public.network_fees f
    where f.fee = p_fee
      and (f.clinic_id = p_clinic_id or f.clinic_id is null)
    order by (f.clinic_id is not null) desc
    limit 1
  ),
  camp as (
    select c.*
    from public.network_fee_campaigns c, dia
    where c.active
      and (c.clinic_id = p_clinic_id or c.clinic_id is null)
      -- Nulo ou vazio = todas as taxas.
      and (c.fees is null or cardinality(c.fees) = 0 or p_fee = any(c.fees))
      and dia.d between c.starts_on and c.ends_on
    order by (c.clinic_id is not null) desc,
             (c.fees is not null and cardinality(c.fees) > 0) desc,
             c.starts_on desc
    limit 1
  )
  select
    b.kind,
    case
      when c.id is null then b.percent
      when c.mode = 'valor' then coalesce(c.percent, b.percent)
      else round(b.percent * (1 - coalesce(c.discount_percent, 0) / 100.0), 4)
    end,
    case
      when c.id is null then b.amount_cents
      when c.mode = 'valor' then coalesce(c.amount_cents, b.amount_cents)
      else round(b.amount_cents
                 * (1 - coalesce(c.discount_percent, 0) / 100.0))::bigint
    end,
    b.due_day,
    b.active and coalesce(
      (select t.active from public.network_fee_types t where t.key = p_fee),
      true),
    b.is_override,
    b.note,
    c.name
  from base b
  left join camp c on true;
$$;

grant execute on function public.network_fee_for(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Excluir taxa: agora também olha as campanhas
-- -----------------------------------------------------------------------------
create or replace function public.delete_network_fee_type(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type record;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_type from public.network_fee_types where key = p_key;
  if v_type.key is null then return; end if;
  if v_type.system then raise exception 'FEE_IS_SYSTEM'; end if;

  if exists (select 1 from public.split_charges where fee = p_key)
     or exists (select 1 from public.payables where network_fee = p_key) then
    raise exception 'FEE_IN_USE';
  end if;

  -- Tirar a taxa da lista de uma campanha a esvaziaria, e vazia significa
  -- TODAS: a campanha de uma taxa viraria campanha de todas sem ninguém pedir.
  if exists (
    select 1 from public.network_fee_campaigns c
     where c.fees is not null and p_key = any(c.fees)
  ) then
    raise exception 'FEE_IN_CAMPAIGN';
  end if;

  delete from public.network_fee_types where key = p_key;
end;
$$;

revoke all on function public.delete_network_fee_type(text) from public;
grant execute on function public.delete_network_fee_type(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.network_fee_campaigns) as campanhas,
  (select count(*) from public.network_fee_campaigns
    where fees is null or cardinality(fees) = 0) as campanhas_de_todas_as_taxas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'network_fee_campaigns'
      and column_name = 'fee') as coluna_antiga_ainda_existe,
  (select count(*) from public.network_fee_types) as taxas_no_catalogo;
