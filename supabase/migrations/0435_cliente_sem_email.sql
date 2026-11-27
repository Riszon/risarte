-- =============================================================================
-- 0435 — OC-00025: "Cliente sem e-mail" no cadastro
-- -----------------------------------------------------------------------------
-- O cadastro completo continua sendo a régua do dono (27/07/2026, 0173): sem
-- ele a agenda não marca. O que muda: quem REALMENTE não tem e-mail (muitos
-- idosos) passa a ter a marcação "Cliente sem e-mail", igual à "Cliente sem
-- CPF". Marcado, o e-mail deixa de faltar. O CEP e o endereço continuam
-- obrigatórios (decisão do dono, 26/11/2026).
--
-- Regra: com e-mail preenchido, a marcação se desfaz sozinha (o gatilho
-- limpa) — "sem e-mail" e um e-mail ao mesmo tempo não existem.
--
-- Recria `clients_set_registration_complete` (0173) — quem recriar de novo
-- parte DESTA. Idempotente.
-- =============================================================================

alter table public.clients
  add column if not exists no_email boolean not null default false;

create or replace function public.clients_set_registration_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
  v_minor boolean;
begin
  -- OC-00025: com e-mail, não existe "sem e-mail".
  if coalesce(btrim(new.email), '') <> '' then
    new.no_email := false;
  end if;

  v_minor := new.birth_date is not null
             and new.birth_date > (current_date - interval '18 years');

  v_ok :=
        coalesce(btrim(new.full_name), '') <> ''
    and (new.no_cpf or coalesce(btrim(new.cpf), '') <> '')
    and new.birth_date is not null
    and coalesce(btrim(new.phone), '') <> ''
    and (new.no_email or coalesce(btrim(new.email), '') <> '')
    and coalesce(btrim(new.address), '') <> ''
    and coalesce(btrim(new.address_number), '') <> ''
    and coalesce(btrim(new.neighborhood), '') <> ''
    and coalesce(btrim(new.city), '') <> ''
    and coalesce(btrim(new.state), '') <> ''
    and coalesce(btrim(new.zip_code), '') <> '';

  -- Menor de idade só está completo com responsável cadastrado.
  if v_ok and v_minor then
    v_ok := exists (
      select 1 from public.client_guardians g where g.client_id = new.id
    );
  end if;

  new.registration_complete := v_ok;
  return new;
end;
$$;

-- Função de gatilho: ninguém chama pela API.
revoke execute on function public.clients_set_registration_complete() from public, anon, authenticated;

-- Conferência (o dono roda e vê: true · 0):
--   select
--     exists (select 1 from information_schema.columns
--              where table_schema = 'public' and table_name = 'clients'
--                and column_name = 'no_email') as coluna_existe,
--     (select count(*) from public.clients where no_email) as marcados;
