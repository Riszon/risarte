-- =============================================================================
-- 0173 — I4: cadastro incompleto (selo, filtro e trava no agendamento)
-- -----------------------------------------------------------------------------
-- Clientes que entram pelo Risarte Empresarial (e por qualquer integração) são
-- criados PRÉ-CADASTRADOS: só nome, CPF e telefone. O cadastro completo é o
-- mesmo exigido no formulário de novo cliente do prontuário (decisão do dono):
--   nome · CPF (ou "cliente sem CPF") · nascimento · telefone · e-mail ·
--   CEP · endereço · número · bairro · cidade · UF
--   + menor de 18 anos precisa de pelo menos um responsável.
-- (Complemento é opcional.)
--
-- `clients.registration_complete` passa a guardar esse resultado, mantido por
-- gatilho — assim dá para FILTRAR a lista e TRAVAR o agendamento sem recalcular
-- em cada tela. Idempotente.
-- =============================================================================

-- "Cliente sem CPF" era só uma marcação do formulário e se perdia ao salvar;
-- agora fica registrada (senão o cadastro nunca ficaria completo).
alter table public.clients
  add column if not exists no_cpf boolean not null default false,
  add column if not exists registration_complete boolean not null default false;

create index if not exists clients_registration_complete_idx
  on public.clients (clinic_id, registration_complete);

create or replace function public.clients_set_registration_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
  v_minor boolean;
begin
  v_minor := new.birth_date is not null
             and new.birth_date > (current_date - interval '18 years');

  v_ok :=
        coalesce(btrim(new.full_name), '') <> ''
    and (new.no_cpf or coalesce(btrim(new.cpf), '') <> '')
    and new.birth_date is not null
    and coalesce(btrim(new.phone), '') <> ''
    and coalesce(btrim(new.email), '') <> ''
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

drop trigger if exists clients_registration_complete_trg on public.clients;
create trigger clients_registration_complete_trg
  before insert or update on public.clients
  for each row execute function public.clients_set_registration_complete();

-- Incluir/remover responsável muda o resultado do menor de idade.
create or replace function public.client_guardians_refresh_completeness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid := coalesce(new.client_id, old.client_id);
begin
  if v_client is not null then
    -- O update dispara o gatilho de cima, que recalcula o campo.
    update public.clients
       set registration_complete = registration_complete
     where id = v_client;
  end if;
  return null;
end;
$$;

drop trigger if exists client_guardians_completeness_trg on public.client_guardians;
create trigger client_guardians_completeness_trg
  after insert or delete on public.client_guardians
  for each row execute function public.client_guardians_refresh_completeness();

-- Recalcula todo mundo uma vez (dispara o gatilho linha a linha).
do $$
begin
  update public.clients set registration_complete = registration_complete;
exception when others then
  raise notice 'Recalculo de registration_complete ignorado: %', sqlerrm;
end $$;
