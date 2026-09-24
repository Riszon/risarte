-- =============================================================================
-- 1020 — A QUANTIDADE CONTRATADA E O TERMO DE INCLUSÃO (OC-00083, I4)
--
-- Pedido do dono (24/09/2026): "uma proposta que foi aceita e fechada com uma
-- quantidade de titulares definidos deve abrir a possibilidade de fazer
-- cadastros de Titulares somente com a quantidade fechada e no contrato... a
-- empresa tem 100 colaboradores, e quando foi fazer o cadastro enviou 120
-- nomes, o sistema não pode permitir cadastrar os 120, deve cadastrar somente
-- os 100 que foi combinado. Deve ter algum botão para acrescentar mais
-- colaboradores, para isso deve gerar uma proposta para incluir os novos...
-- onde deve ser feito os cálculos para a empresa fazer o pagamento da
-- diferença."
--
-- E, para o acordo de VALOR FIXO: "deve ser definido a quantidade máxima de
-- adesões para aquele acordo (sendo por titulares ou dependentes ou ambos) de
-- acordo o combinado na proposta. E já deixar definido os valores em caso de
-- exceder o teto máximo (pode ser uma nova faixa de valor fixo ou por adesões
-- de titulares ou dependentes)."
--
-- ⚠️ POR QUE UM CAMPO NOVO, E NÃO `companies.employee_count`. Aquele campo é
-- EDITÁVEL À MÃO na ficha da empresa — é "quantas pessoas a empresa tem". Usar
-- o mesmo número como limite de contrato faria a trava mudar sozinha quando
-- alguém corrigisse o cadastro, e ninguém entenderia por quê. A quantidade
-- contratada vem da proposta e só muda por termo de inclusão.
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O que foi FECHADO no contrato
-- -----------------------------------------------------------------------------
alter table empresarial.companies
  add column if not exists contracted_holders int,
  add column if not exists contracted_dependents int;

comment on column empresarial.companies.contracted_holders is
  'Quantos TITULARES o contrato fechou. É o limite de cadastro, somado ao que '
  'os termos de inclusão aceitos acrescentarem. NULO = contrato sem '
  'quantidade fechada, e aí não há trava (toda empresa antiga é assim).';
comment on column empresarial.companies.contracted_dependents is
  'Quantos DEPENDENTES o contrato fechou, quando o acordo tem teto de '
  'dependentes. NULO = sem teto de dependentes.';

do $$
begin
  alter table empresarial.companies
    add constraint companies_quantidade_contratada
    check (
      (contracted_holders is null or contracted_holders >= 0)
      and (contracted_dependents is null or contracted_dependents >= 0)
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) A REGRA DO EXCEDENTE, combinada na proposta
-- -----------------------------------------------------------------------------
--
-- Decisão do dono para o acordo de valor fixo: o teto é definido na proposta,
-- e os valores do excedente TAMBÉM — "pode ser uma nova faixa de valor fixo ou
-- por adesões de titulares ou dependentes".
--
-- Deixar isso combinado na proposta é o que permite o termo de inclusão nascer
-- com o número pronto, em vez de virar uma renegociação do zero toda vez que
-- entrar uma pessoa a mais.
alter table empresarial.lead_qualification
  add column if not exists excess_mode varchar(14),
  add column if not exists excess_fixed_cents bigint,
  add column if not exists excess_holder_fee_cents bigint,
  add column if not exists excess_dependent_fee_cents bigint;

comment on column empresarial.lead_qualification.excess_mode is
  'O que acontece ao passar do contratado: NEW_FIXED (o pacote passa a valer '
  'outro valor fixo) ou PER_ADHESION (cada pessoa a mais tem preço). NULO = '
  'não foi combinado, e o termo de inclusão nasce sem valor sugerido.';

do $$
begin
  alter table empresarial.lead_qualification
    add constraint lead_qualification_excedente
    check (
      (excess_mode is null or excess_mode in ('NEW_FIXED','PER_ADHESION'))
      and (excess_fixed_cents is null or excess_fixed_cents >= 0)
      and (excess_holder_fee_cents is null or excess_holder_fee_cents >= 0)
      and (excess_dependent_fee_cents is null or excess_dependent_fee_cents >= 0)
    );
exception
  when duplicate_object then null;
end $$;

-- O mesmo no cadastro, para o fechamento ter onde escrever.
alter table empresarial.companies
  add column if not exists excess_mode varchar(14),
  add column if not exists excess_fixed_cents bigint,
  add column if not exists excess_holder_fee_cents bigint,
  add column if not exists excess_dependent_fee_cents bigint;

do $$
begin
  alter table empresarial.companies
    add constraint companies_excedente
    check (
      (excess_mode is null or excess_mode in ('NEW_FIXED','PER_ADHESION'))
      and (excess_fixed_cents is null or excess_fixed_cents >= 0)
      and (excess_holder_fee_cents is null or excess_holder_fee_cents >= 0)
      and (excess_dependent_fee_cents is null or excess_dependent_fee_cents >= 0)
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 3) O TERMO DE INCLUSÃO
-- -----------------------------------------------------------------------------
--
-- ⚠️ É UM DOCUMENTO CURTO, e isso é decisão do dono: *"gerando um documento
-- mais simples que a proposta inicial (mais curto), mas lembrando a empresa
-- que o titular está sendo cadastrado no programa e é referente ao acordo que
-- já existe entre a Risarte e a empresa"*. Ele não renegocia benefício,
-- carência nem unidade — só acrescenta gente ao que já foi combinado.
--
-- ⚠️ E ELE PRECISA SER ACEITO. Enquanto estiver em rascunho, os cadastros
-- acima do contratado continuam barrados: é o aceite que autoriza, e é ele
-- que a empresa vai reconhecer quando a diferença for cobrada.
create sequence if not exists empresarial.inclusion_term_code_seq;

create table if not exists empresarial.company_inclusion_terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  -- O CÓDIGO NUNCA SOME (regra do dono, 07/08/2026): é ele que amarra o termo
  -- à cobrança e ao histórico.
  code varchar(20) not null unique,
  holders int not null default 0 check (holders >= 0),
  dependents int not null default 0 check (dependents >= 0),
  -- Os valores CONGELADOS no momento em que o termo foi gerado. Mudar a regra
  -- da empresa depois não pode reescrever o que a empresa aceitou.
  holder_fee_cents bigint,
  dependent_fee_cents bigint,
  fixed_cents bigint,
  monthly_delta_cents bigint not null default 0,
  implantation_cents bigint not null default 0,
  status varchar(12) not null default 'RASCUNHO'
    check (status in ('RASCUNHO','ACEITO','CANCELADO')),
  accepted_at timestamptz,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Termo que não acrescenta ninguém não é termo.
  constraint company_inclusion_terms_tem_gente check (holders > 0 or dependents > 0)
);
create index if not exists company_inclusion_terms_company_idx
  on empresarial.company_inclusion_terms (company_id, status);

drop trigger if exists company_inclusion_terms_set_updated_at
  on empresarial.company_inclusion_terms;
create trigger company_inclusion_terms_set_updated_at
  before update on empresarial.company_inclusion_terms
  for each row execute function public.set_updated_at();

create or replace function empresarial.set_inclusion_term_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'TI-' ||
      lpad(nextval('empresarial.inclusion_term_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists company_inclusion_terms_code
  on empresarial.company_inclusion_terms;
create trigger company_inclusion_terms_code
  before insert on empresarial.company_inclusion_terms
  for each row execute function empresarial.set_inclusion_term_code();

alter table empresarial.company_inclusion_terms enable row level security;

drop policy if exists company_inclusion_terms_select
  on empresarial.company_inclusion_terms;
create policy company_inclusion_terms_select
  on empresarial.company_inclusion_terms for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));

-- Criar e aceitar termo mexe no que a empresa vai pagar: é ato de gestor do
-- programa, não de quem cadastra pessoa.
drop policy if exists company_inclusion_terms_write
  on empresarial.company_inclusion_terms;
create policy company_inclusion_terms_write
  on empresarial.company_inclusion_terms for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update, delete
  on empresarial.company_inclusion_terms to authenticated;
grant all on empresarial.company_inclusion_terms to service_role;
grant usage, select on sequence empresarial.inclusion_term_code_seq to authenticated;
grant all on sequence empresarial.inclusion_term_code_seq to service_role;

-- -----------------------------------------------------------------------------
-- 4) QUANTOS TITULARES ESTA EMPRESA PODE TER HOJE
-- -----------------------------------------------------------------------------
--
-- Contratado + o que os termos ACEITOS acrescentaram. Fica no banco, e não só
-- no app, porque é a conta que decide se um cadastro entra — e a mesma
-- resposta precisa valer para a tela, para a importação de planilha e para
-- qualquer caminho futuro.
--
-- Devolve NULO quando não há quantidade contratada: "sem contrato de
-- quantidade" não é "limite zero", e confundir os dois travaria toda empresa
-- que já existe.
create or replace function empresarial.limite_de_titulares(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.contracted_holders is null then null
    else c.contracted_holders + coalesce((
      select sum(t.holders)
      from empresarial.company_inclusion_terms t
      where t.company_id = p_company_id
        and t.status = 'ACEITO'
    ), 0)
  end
  from empresarial.companies c
  where c.id = p_company_id;
$$;

revoke all on function empresarial.limite_de_titulares(uuid) from public;
grant execute on function empresarial.limite_de_titulares(uuid) to authenticated, service_role;

comment on function empresarial.limite_de_titulares(uuid) is
  'Quantos titulares a empresa pode ter: o contratado mais o que os termos de '
  'inclusão ACEITOS acrescentaram. NULO = contrato sem quantidade fechada, '
  'portanto sem trava.';
