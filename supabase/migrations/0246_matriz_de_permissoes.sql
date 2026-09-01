-- =============================================================================
-- 0246 — A matriz de permissões vira DADO, não código
-- -----------------------------------------------------------------------------
-- Antes, quem enxerga cada módulo estava escrito dentro do código: mudar "o
-- Coordenador passa a ver Relatórios" exigia editar um arquivo e publicar.
-- Agora a resposta vem desta tabela, e o Admin Master troca pela tela
-- `/admin/permissoes`.
--
-- ⚠️ O QUE ESTA MATRIZ GOVERNA, E O QUE NÃO GOVERNA.
--
-- Ela decide se o módulo ABRE (a guarda do aplicativo, o `redirect("/")` no
-- layout de cada módulo). Ela NÃO reescreve as políticas de RLS: o que cada
-- pessoa lê e escreve dentro do módulo continua decidido por centenas de
-- políticas, cada uma com a lista de papéis no próprio texto.
--
-- Consequência, e a tela diz isso em voz alta: **desligar sempre funciona** (o
-- aplicativo barra antes de chegar ao banco), mas **ligar além do padrão pode
-- abrir a tela com os dados vazios**. As capacidades nessa situação estão
-- marcadas na tela com o aviso "o banco também decide".
--
-- O ADMIN MASTER NÃO ENTRA NA MATRIZ. Ele passa por cima, sempre. Uma matriz
-- que pudesse tirar o acesso do próprio administrador criaria a porta trancada
-- com a chave dentro — e não haveria como destrancar pela tela.
--
-- A semente reproduz EXATAMENTE o que o código fazia antes desta migração, para
-- que ligar a funcionalidade não mude o comportamento de ninguém no primeiro
-- dia. Idempotente.
-- =============================================================================

create table if not exists public.permission_matrix (
  capability text not null,
  role public.user_role not null,
  allowed boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (capability, role)
);

comment on table public.permission_matrix is
  'Quem pode o quê, por papel. Governa as guardas do APLICATIVO; a RLS continua sendo a barreira final. Editada em /admin/permissoes pelo Admin Master.';

alter table public.permission_matrix enable row level security;

-- LEITURA para qualquer pessoa logada: o próprio sistema precisa consultar a
-- matriz a cada tela para montar o menu de quem está entrando.
drop policy if exists "permission_matrix_select" on public.permission_matrix;
create policy "permission_matrix_select" on public.permission_matrix
  for select to authenticated using (true);

-- ESCRITA só do Admin Master, e conferida NO BANCO. Esconder o botão na tela é
-- conforto; a barreira é esta.
drop policy if exists "permission_matrix_write" on public.permission_matrix;
create policy "permission_matrix_write" on public.permission_matrix
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- A porta de escrita.
-- -----------------------------------------------------------------------------
-- Uma função só, em vez de deixar a tela escrever linha a linha: assim a troca
-- inteira de uma permissão acontece numa transação, e nunca fica pela metade
-- (um papel ganhando acesso e outro não, porque a rede caiu no meio).
create or replace function public.set_permission(
  p_capability text,
  p_roles public.user_role[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_capability is null or btrim(p_capability) = '' then
    raise exception 'CAPABILITY_REQUIRED';
  end if;

  -- Apaga e regrava a capacidade inteira: o conjunto de papéis É o valor, e
  -- atualizar linha a linha deixaria papel órfão de uma edição anterior.
  delete from public.permission_matrix where capability = p_capability;

  insert into public.permission_matrix (capability, role, allowed, updated_by)
  select p_capability, r, true, v_user
    from unnest(coalesce(p_roles, '{}'::public.user_role[])) as r;
end;
$$;

revoke all on function public.set_permission(text, public.user_role[]) from public;
grant execute on function public.set_permission(text, public.user_role[]) to authenticated;

-- -----------------------------------------------------------------------------
-- A SEMENTE — o que o código fazia antes desta migração.
-- -----------------------------------------------------------------------------
-- `on conflict do nothing` de propósito: rodar a migração de novo não desfaz
-- ajuste que o dono já tenha feito pela tela.
insert into public.permission_matrix (capability, role) values
  -- Navegação: todos os papéis, menos a exceção do dentista na Jornada.
  ('menu.jornada','receptionist'),('menu.jornada','sdr'),
  ('menu.jornada','clinical_coordinator'),('menu.jornada','planner_dentist'),
  ('menu.jornada','commercial_consultant'),('menu.jornada','commercial_assistant'),
  ('menu.jornada','unit_manager'),('menu.jornada','franchisor_staff'),
  ('menu.jornada','franchisee'),('menu.jornada','tsb'),('menu.jornada','asb'),
  ('menu.jornada','rislife_consultant'),('menu.jornada','finance_franchisor'),
  ('menu.jornada','purchaser'),

  ('menu.agenda','receptionist'),('menu.agenda','sdr'),
  ('menu.agenda','clinical_coordinator'),('menu.agenda','planner_dentist'),
  ('menu.agenda','dentist'),('menu.agenda','commercial_consultant'),
  ('menu.agenda','commercial_assistant'),('menu.agenda','unit_manager'),
  ('menu.agenda','franchisor_staff'),('menu.agenda','franchisee'),
  ('menu.agenda','tsb'),('menu.agenda','asb'),('menu.agenda','rislife_consultant'),
  ('menu.agenda','finance_franchisor'),('menu.agenda','purchaser'),

  ('menu.atendimento','receptionist'),('menu.atendimento','sdr'),
  ('menu.atendimento','clinical_coordinator'),('menu.atendimento','planner_dentist'),
  ('menu.atendimento','dentist'),('menu.atendimento','commercial_consultant'),
  ('menu.atendimento','commercial_assistant'),('menu.atendimento','unit_manager'),
  ('menu.atendimento','franchisor_staff'),('menu.atendimento','franchisee'),
  ('menu.atendimento','tsb'),('menu.atendimento','asb'),
  ('menu.atendimento','rislife_consultant'),('menu.atendimento','finance_franchisor'),
  ('menu.atendimento','purchaser'),

  ('menu.prontuarios','receptionist'),('menu.prontuarios','sdr'),
  ('menu.prontuarios','clinical_coordinator'),('menu.prontuarios','planner_dentist'),
  ('menu.prontuarios','dentist'),('menu.prontuarios','commercial_consultant'),
  ('menu.prontuarios','commercial_assistant'),('menu.prontuarios','unit_manager'),
  ('menu.prontuarios','franchisor_staff'),('menu.prontuarios','franchisee'),
  ('menu.prontuarios','tsb'),('menu.prontuarios','asb'),
  ('menu.prontuarios','rislife_consultant'),('menu.prontuarios','finance_franchisor'),
  ('menu.prontuarios','purchaser'),

  -- Antes da matriz estes dois eram `isAdminMaster || isPlanner`: só o Planner
  -- entra na semente, e o Admin passa por cima da matriz de qualquer forma.
  ('menu.planejamento','planner_dentist'),
  ('menu.procedimentos','planner_dentist'),

  -- Módulos
  ('modulo.planos','franchisor_staff'),('modulo.planos','planner_dentist'),
  ('modulo.planos','commercial_consultant'),('modulo.planos','unit_manager'),
  ('modulo.planos','clinical_coordinator'),('modulo.planos','franchisee'),

  ('modulo.comercial','commercial_consultant'),('modulo.comercial','commercial_assistant'),
  ('modulo.comercial','unit_manager'),('modulo.comercial','franchisee'),

  ('modulo.relatorios','franchisor_staff'),('modulo.relatorios','planner_dentist'),
  ('modulo.relatorios','commercial_consultant'),('modulo.relatorios','unit_manager'),
  ('modulo.relatorios','franchisee'),

  ('modulo.risartanos','unit_manager'),('modulo.risartanos','franchisor_staff'),
  ('modulo.risartanos','franchisee'),

  ('modulo.ppr','receptionist'),('modulo.ppr','sdr'),
  ('modulo.ppr','clinical_coordinator'),('modulo.ppr','planner_dentist'),
  ('modulo.ppr','dentist'),('modulo.ppr','commercial_consultant'),
  ('modulo.ppr','commercial_assistant'),('modulo.ppr','unit_manager'),
  ('modulo.ppr','franchisor_staff'),('modulo.ppr','franchisee'),
  ('modulo.ppr','tsb'),('modulo.ppr','asb'),('modulo.ppr','rislife_consultant'),
  ('modulo.ppr','finance_franchisor'),('modulo.ppr','purchaser'),

  ('modulo.empresarial','rislife_consultant'),('modulo.empresarial','franchisor_staff'),
  ('modulo.empresarial','finance_franchisor'),('modulo.empresarial','unit_manager'),
  ('modulo.empresarial','franchisee'),('modulo.empresarial','sdr'),
  ('modulo.empresarial','receptionist'),

  ('modulo.financeiro','finance_franchisor'),('modulo.financeiro','unit_manager'),
  ('modulo.financeiro','franchisee'),

  ('modulo.estoque','finance_franchisor'),('modulo.estoque','unit_manager'),
  ('modulo.estoque','franchisee'),('modulo.estoque','dentist'),
  ('modulo.estoque','clinical_coordinator'),('modulo.estoque','planner_dentist'),
  ('modulo.estoque','tsb'),('modulo.estoque','asb'),

  ('modulo.compras','unit_manager'),('modulo.compras','purchaser'),
  ('modulo.compras','franchisee'),('modulo.compras','finance_franchisor'),

  -- Ações
  ('acao.financeiro.lancar','finance_franchisor'),
  ('acao.financeiro.lancar','unit_manager'),
  ('acao.financeiro.configurar_rede','finance_franchisor'),

  ('acao.estoque.gerir','finance_franchisor'),('acao.estoque.gerir','unit_manager'),
  ('acao.estoque.consumir','finance_franchisor'),('acao.estoque.consumir','unit_manager'),
  ('acao.estoque.consumir','dentist'),('acao.estoque.consumir','clinical_coordinator'),
  ('acao.estoque.consumir','planner_dentist'),('acao.estoque.consumir','tsb'),
  ('acao.estoque.consumir','asb'),
  ('acao.estoque.catalogo','finance_franchisor'),

  ('acao.compras.requisitar','unit_manager'),
  ('acao.compras.negociar','purchaser')
on conflict (capability, role) do nothing;
