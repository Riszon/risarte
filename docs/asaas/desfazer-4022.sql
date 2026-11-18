-- DESFAZER a 4022 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
--
-- A 4022 CRIA 16 funções e REDEFINE uma (`_central_readiness_raw`, a lista da
-- prontidão da unidade). Desfazer = tirar as 16 e devolver a prontidão da 4009
-- (os 8 itens de antes). Ficam, com o que tiver sido gravado (não apaga dado):
-- as tabelas gateway_account_surveys, gateway_charge_issues e
-- gateway_charge_recon_runs, as colunas novas de gateway_accounts e
-- gateway_settings e a pasta privada asaas-rede.
--
-- O interruptor de produção NÃO é mexido: se foi ligado, continua ligado.
-- Antes da 4022, só o banco o mudava; confira e decida antes de desfazer.

drop function if exists public.gateway_production_switch(boolean, text);
drop function if exists public.gateway_production_read();
drop function if exists public.gateway_asaas_confirmation_save(text, text);
drop function if exists public._gateway_network_readiness();
drop function if exists public._gateway_cap_effective_roles(text);
drop function if exists public.gateway_asaas_migrations();
drop function if exists public.gateway_declare_debit_disabled(uuid);
drop function if exists public.gateway_declare_key_permissions(uuid);
drop function if exists public._gateway_key_probe_save(uuid, boolean, jsonb);
drop function if exists public._gateway_survey_save(uuid, uuid, jsonb);
drop function if exists public.gateway_surveys_read(uuid);
drop function if exists public._gateway_charge_recon_save(uuid, text, jsonb, jsonb, integer);
drop function if exists public.gateway_charge_issues_read(uuid);
drop function if exists public.gateway_charge_issue_ignore(uuid, text);
drop function if exists public.central_copy_preview(uuid, uuid);
drop function if exists public.central_copy_apply(uuid, uuid, text[]);

-- A prontidão da unidade como era na 4009.
create or replace function public._central_readiness_raw(p_clinic_id uuid)
returns table(item text, ok boolean, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_today date := public.today_br();
  v_has_account boolean;
begin
  select a.* into v_acc
    from public.gateway_accounts a
   where a.id = public._gateway_account_of(p_clinic_id);
  v_has_account := found;

  return query
  select 'conta_validada'::text,
         coalesce(v_has_account and v_acc.status = 'active' and v_acc.last_check_ok is not false, false),
         10
  union all
  select 'wallet_id',
         coalesce(v_has_account and length(coalesce(v_acc.wallet_id, '')) > 0, false),
         20
  union all
  select 'webhook_ativo',
         coalesce(v_has_account and v_acc.webhook_id is not null and v_acc.webhook_token_secret_id is not null
                  and v_acc.webhook_events_ok is not false, false),
         30
  union all
  select 'tarifas',
         coalesce(v_has_account and exists (
           select 1
             from public.card_acquirers c
             join public.acquirer_rates r on r.acquirer_id = c.id
            where c.gateway_account_id = v_acc.id
              and r.valid_from <= v_today
              and (r.valid_to is null or r.valid_to >= v_today)
         ), false),
         40
  union all
  select 'chave_pix',
         coalesce(v_has_account and v_acc.pix_key_active is true, false),
         50
  union all
  select 'split_habilitado',
         coalesce(v_has_account and (v_acc.split_enabled_confirmed_at is not null
                                     or v_acc.split_enabled_declared_at is not null), false),
         60
  union all
  select 'termo_registrado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or v_acc.term_registered_at is not null), false),
         70
  union all
  select 'antecipacao_desligada',
         coalesce(v_has_account and v_acc.anticipation_auto_enabled is false, false),
         80;
end;
$$;
revoke execute on function public._central_readiness_raw(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Conferência: 0 funções da 4022 restantes e 8 itens na prontidão.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('gateway_production_switch', 'gateway_production_read', '_gateway_network_readiness',
                       '_gateway_charge_recon_save', 'gateway_charge_issues_read', 'central_copy_apply')) as funcoes_restantes,
  (select count(*) from public._central_readiness_raw(null)) as itens_da_prontidao;
