-- =============================================================================
-- 1006 — A LISTA DE BOAS-VINDAS DO RISARTE EMPRESARIAL
--
-- Pedido do dono (11/09/2026): *"em cada empresa deve ter como gerar um
-- relatório simplificado dos colaboradores e seus dependentes para que a
-- recepcionista ou SDR possa entrar em contato para dar as boas-vindas,
-- completar cadastros e iniciar agendamentos. Caso tiver carências a ser
-- respeitadas devem estar presentes neste relatório."*
--
-- ⚠️ ISTO NÃO É UM RELATÓRIO, É UMA FILA DE TRABALHO — e a diferença importa.
-- Uma empresa nova entra com dezenas de pessoas; sem registro de quem já foi
-- chamado, duas recepcionistas ligam para a mesma pessoa e outra não recebe
-- ligação nenhuma. O papel na mesa resolve isso para UMA pessoa; não resolve
-- para duas, nem sobrevive à troca de turno.
--
-- ⚠️ O RESULTADO DA LIGAÇÃO É PARTE DO REGISTRO. "Liguei" não diz o que
-- aconteceu: quem não atendeu precisa voltar para a fila, quem pediu para
-- ligar depois também, e quem disse que não quer agora não deve ser cobrado
-- toda semana. Guardar só a data faria a lista esvaziar com o trabalho por
-- fazer.
-- =============================================================================

create table if not exists empresarial.welcome_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,

  -- ⚠️ DUAS CHAVES, UMA PREENCHIDA — o padrão que o projeto já usa em
  -- `payment_installments` (venda OU negociação). Um `person_id` solto com um
  -- campo "tipo" ao lado não teria integridade nenhuma: apagar o dependente
  -- deixaria a linha apontando para o nada, e ninguém descobriria.
  employee_id uuid references empresarial.employees (id) on delete cascade,
  dependent_id uuid references empresarial.dependents (id) on delete cascade,

  outcome varchar(20) not null
    check (outcome in ('CONTACTED','NO_ANSWER','CALL_LATER','DECLINED')),
  note text,
  contacted_at timestamptz not null default now(),
  contacted_by uuid references public.profiles (id),

  constraint welcome_contacts_person_check check (
    (employee_id is not null and dependent_id is null)
    or (employee_id is null and dependent_id is not null)
  )
);

-- ⚠️ UMA LINHA POR PESSOA, e a nova ligação ATUALIZA a anterior. Guardar
-- histórico seria mais completo e pediria uma tela para lê-lo; a pergunta que
-- esta lista responde é "para quem ainda preciso ligar", e para ela só o último
-- contato importa. Os dois índices são parciais porque uma das colunas é
-- sempre nula — um único índice composto deixaria passar duplicata.
create unique index if not exists welcome_contacts_employee_uk
  on empresarial.welcome_contacts (employee_id) where employee_id is not null;
create unique index if not exists welcome_contacts_dependent_uk
  on empresarial.welcome_contacts (dependent_id) where dependent_id is not null;
create index if not exists welcome_contacts_company_idx
  on empresarial.welcome_contacts (company_id, contacted_at desc);

alter table empresarial.welcome_contacts enable row level security;

-- Mesmo alcance das outras tabelas do módulo: quem gere o programa vê tudo; a
-- unidade vê as empresas que tem acesso. A recepção e a SDR entram por aqui —
-- são elas que ligam.
drop policy if exists welcome_contacts_select on empresarial.welcome_contacts;
create policy welcome_contacts_select on empresarial.welcome_contacts
  for select to authenticated
  using (empresarial.is_program_manager()
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists welcome_contacts_write on empresarial.welcome_contacts;
create policy welcome_contacts_write on empresarial.welcome_contacts
  for all to authenticated
  using (empresarial.is_program_manager()
         or company_id in (select empresarial.accessible_company_ids()))
  with check (empresarial.is_program_manager()
         or company_id in (select empresarial.accessible_company_ids()));

-- -----------------------------------------------------------------------------
-- REGISTRAR O CONTATO
--
-- ⚠️ A EMPRESA NÃO VEM DA TELA, vem da pessoa. Recebê-la como parâmetro
-- deixaria a porta aberta para gravar um contato de uma empresa apontando para
-- a pessoa de outra — e a lista da outra empresa passaria a esconder alguém que
-- nunca foi chamado. Aqui o `company_id` é lido do próprio colaborador.
-- -----------------------------------------------------------------------------
create or replace function empresarial.register_welcome_contact(
  p_employee_id uuid,
  p_dependent_id uuid,
  p_outcome text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_company uuid;
  v_user uuid := (select auth.uid());
begin
  if (p_employee_id is null) = (p_dependent_id is null) then
    raise exception 'PERSON_REQUIRED';
  end if;

  if p_employee_id is not null then
    select e.company_id into v_company
      from empresarial.employees e where e.id = p_employee_id;
  else
    select e.company_id into v_company
      from empresarial.dependents d
      join empresarial.employees e on e.id = d.employee_id
     where d.id = p_dependent_id;
  end if;

  if v_company is null then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  -- A guarda é a mesma da RLS. `security definer` passa por cima dela, então
  -- sem esta linha qualquer usuário autenticado gravaria contato em empresa que
  -- não enxerga (lição da 0227, no Financeiro).
  if not (empresarial.is_program_manager()
          or v_company in (select empresarial.accessible_company_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- ⚠️ ATUALIZA E SÓ DEPOIS INSERE, em vez de `on conflict`. São DOIS índices
  -- únicos parciais (um por coluna de pessoa) e um `insert` só aceita um alvo
  -- de conflito — escrito com `on conflict (employee_id)`, o caminho do
  -- DEPENDENTE cairia fora da regra e criaria linha duplicada a cada ligação.
  -- Os índices continuam lá como rede: se dois cliques chegarem ao mesmo tempo,
  -- o banco recusa o segundo em vez de duplicar.
  update empresarial.welcome_contacts w
     set outcome = p_outcome,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         contacted_at = now(),
         contacted_by = v_user
   where (p_employee_id is not null and w.employee_id = p_employee_id)
      or (p_dependent_id is not null and w.dependent_id = p_dependent_id);

  if not found then
    insert into empresarial.welcome_contacts
      (company_id, employee_id, dependent_id, outcome, note, contacted_at, contacted_by)
    values
      (v_company, p_employee_id, p_dependent_id, p_outcome,
       nullif(btrim(coalesce(p_note, '')), ''), now(), v_user);
  end if;
end;
$fn$;

revoke all on function empresarial.register_welcome_contact(uuid, uuid, text, text) from public;
grant execute on function empresarial.register_welcome_contact(uuid, uuid, text, text) to authenticated;

-- Desfazer: a ligação registrada por engano some da lista de "já contatados".
create or replace function empresarial.clear_welcome_contact(
  p_employee_id uuid,
  p_dependent_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_company uuid;
begin
  select w.company_id into v_company
    from empresarial.welcome_contacts w
   where (p_employee_id is not null and w.employee_id = p_employee_id)
      or (p_dependent_id is not null and w.dependent_id = p_dependent_id);

  if v_company is null then
    return; -- nada registrado: desfazer o que não existe não é erro
  end if;

  if not (empresarial.is_program_manager()
          or v_company in (select empresarial.accessible_company_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;

  delete from empresarial.welcome_contacts w
   where (p_employee_id is not null and w.employee_id = p_employee_id)
      or (p_dependent_id is not null and w.dependent_id = p_dependent_id);
end;
$fn$;

revoke all on function empresarial.clear_welcome_contact(uuid, uuid) from public;
grant execute on function empresarial.clear_welcome_contact(uuid, uuid) to authenticated;
