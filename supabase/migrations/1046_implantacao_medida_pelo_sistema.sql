-- =============================================================================
-- 1046 — A IMPLANTAÇÃO MEDIDA PELO SISTEMA (Empresarial 0.106.0, 16/11/2026)
--
-- Pedido do dono (relato da produção): no funil, a empresa que fechou não
-- mostrava o cartão de ganho; o cartão da Implantação devia mostrar o % já
-- feito; e os passos da implantação eram marcados à mão — devem ser
-- automáticos, "ajustando para que seja viável e não trave tudo".
--
-- O QUE MUDA: uma função de LEITURA devolve, por lead, o que o sistema já
-- sabe medir. A tela faz a conta do % (pura, `implantacao.ts`) e a marca à
-- mão fica só para a exceção ("concluir mesmo assim", com motivo).
--
--   • ganho_em ............ quando o lead entrou em Fechamento (ganho) — o
--                           histórico de fases; o selo "Ganho" do cartão.
--   • contratados/ativos .. titulares contratados (+ termos aceitos) e ativos
--                           → "Cadastrar os titulares".
--   • boas_vindas ......... titulares ativos com boas-vindas registradas
--                           (contatado ou recusou) → "Dar as boas-vindas".
--   • com_agendamento ..... titulares ativos com algum agendamento não
--                           cancelado → "Agendar a primeira consulta".
--   • orientacoes_em ...... primeiro envio registrado com "Orientações do
--                           programa" → "Enviar as orientações".
--   • apresentacao_em ..... reunião da agenda REALIZADA depois do ganho →
--                           "Apresentação para todos os titulares".
--
-- ⚠️ SÓ CONTAGENS E DATAS: nenhum nome, CPF ou dado de paciente sai daqui. É
-- por isso que a função pode ler a agenda (`public.appointments`) mesmo para o
-- Consultor RisLife, que não enxerga pacientes (0353): ele vê "3 de 11
-- agendados", nunca quem nem quando.
--
-- ⚠️ A GUARDA É `can_access_lead`: só volta linha de lead que quem chama
-- enxerga. Lead de outro consultor some calado (é lista, não recusa).
--
-- Nada é apagado nem alterado: só uma função nova.
-- =============================================================================

create or replace function empresarial.implantacao_dos_leads(p_lead_ids uuid[])
returns table (
  lead_id uuid,
  ganho_em timestamptz,
  contratados integer,
  ativos integer,
  boas_vindas integer,
  com_agendamento integer,
  orientacoes_em timestamptz,
  apresentacao_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select l.id, l.company_id, l.contract_signed_at
    from empresarial.commercial_leads l
    where l.id = any(coalesce(p_lead_ids, '{}'::uuid[]))
      and empresarial.can_access_lead(l.id)
  ),
  ganho as (
    select a.id as lead_id,
           (select min(h.entered_at)
              from empresarial.commercial_lead_stage_history h
             where h.lead_id = a.id and h.stage = 'CLOSED_WON') as em
    from alvo a
  ),
  titulares as (
    select a.id as lead_id, e.id as employee_id, e.client_id
    from alvo a
    join empresarial.employees e
      on e.company_id = a.company_id and e.status = 'ACTIVE'
  )
  select
    a.id,
    g.em,
    empresarial._limite_de_titulares_raw(a.company_id),
    (select count(*)::int from titulares t where t.lead_id = a.id),
    (select count(*)::int from titulares t
      where t.lead_id = a.id
        and exists (
          select 1 from empresarial.welcome_contacts w
          where w.employee_id = t.employee_id
            and w.outcome in ('CONTACTED', 'DECLINED')
        )),
    (select count(*)::int from titulares t
      where t.lead_id = a.id
        and t.client_id is not null
        and exists (
          select 1 from public.appointments ap
          where ap.client_id = t.client_id
            and ap.status <> 'cancelled'
        )),
    (select min(d.sent_at) from empresarial.lead_dispatches d
      where d.lead_id = a.id and 'GUIDELINES' = any(d.items)),
    (select min(m.starts_at) from empresarial.lead_meetings m
      where m.lead_id = a.id
        and m.status = 'DONE'
        and m.starts_at >= coalesce(g.em, a.contract_signed_at, '-infinity'::timestamptz))
  from alvo a
  join ganho g on g.lead_id = a.id;
$$;

revoke execute on function empresarial.implantacao_dos_leads(uuid[]) from public, anon, authenticated;
grant execute on function empresarial.implantacao_dos_leads(uuid[]) to authenticated, service_role;

comment on function empresarial.implantacao_dos_leads(uuid[]) is
  'Implantação medida pelo sistema (1046): por lead que quem chama enxerga, '
  'a data do ganho e as contagens dos passos (titulares, boas-vindas, '
  'agendamentos, orientações enviadas, apresentação realizada). Só números e '
  'datas — nenhum dado pessoal. A conta do % é do app (implantacao.ts).';

-- CONFERÊNCIA (só leitura): a função existe, logado executa, anônimo não.
select
  p.proname as funcao,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'execute') as logado_executa,
  has_function_privilege('anon', p.oid, 'execute') as anon_executa
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'empresarial' and p.proname = 'implantacao_dos_leads';
