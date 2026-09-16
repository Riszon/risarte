-- =============================================================================
-- 0256 — PROBLEMAS 2.0, PARTE A: a conversa, o módulo e o relógio
-- -----------------------------------------------------------------------------
-- Pedido do dono (16/09/2026): "toda resposta que envio não fica claro e fácil
-- de encontrar as respostas enviadas" e "o tempo que a solicitação está em
-- aberto ou em análise sem uma conclusão efetiva".
--
-- ⚠️ A CAUSA DA PRIMEIRA QUEIXA ERA ESTRUTURAL, não de tela. A 0247 guardava
-- UMA resposta por relato (`system_reports.answer`), e responder de novo
-- SOBRESCREVIA a anterior. Não havia histórico de quem disse o quê, nem quando
-- — só o último texto. E a marca de "já li" (0252) não voltava a zero na
-- segunda resposta, então quem relatou nunca era avisado dela.
--
-- Aqui:
--   1. `system_report_messages` — a conversa. Nada se apaga.
--   2. Toda mudança de situação vira linha na conversa, por GATILHO — vale para
--      qualquer caminho que mude o status, não só para a tela de hoje.
--   3. O relógio: primeira resposta, início da análise, conclusão. Medido no
--      banco, não deduzido depois.
--   4. `module` — a categoria do sistema, lista fechada. É o que permite contar
--      "sugestões por módulo" no painel (Parte C).
--   5. Quem relatou COMPLEMENTA enquanto está aberto e REABRE com motivo
--      quando a solução não funcionou (decisão do dono). Encerrar continua
--      sendo só do Admin Master.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas novas no relato
-- -----------------------------------------------------------------------------
alter table public.system_reports
  add column if not exists module text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists reopened_count integer not null default 0;

-- Lista FECHADA, igual às unidades do estoque: texto livre faria "Financeiro",
-- "financeiro" e "Fin." virarem três categorias no painel. Nulo = relato
-- anterior a esta migração, que o painel mostra como "Sem módulo".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'system_reports_module_check'
  ) then
    alter table public.system_reports
      add constraint system_reports_module_check check (
        module is null or module in (
          'agenda', 'jornada', 'clinico', 'planejamento', 'comercial',
          'financeiro', 'procedimentos', 'estoque', 'compras', 'ppr',
          'empresarial', 'administracao', 'geral', 'outros'
        )
      );
  end if;
end $$;

comment on column public.system_reports.module is
  'Categoria do sistema (lista fechada). Sugerida pela tela de onde a pessoa veio; é a base das sugestões por módulo no painel.';
comment on column public.system_reports.first_response_at is
  'Quando o relato recebeu a PRIMEIRA resposta. Não muda nas seguintes — é o "tempo até responder" do painel.';
comment on column public.system_reports.closed_at is
  'Quando foi encerrado pela última vez (resolvido ou não é defeito). Volta a nulo se for reaberto.';

create index if not exists system_reports_module_idx
  on public.system_reports (module, kind, status);

-- -----------------------------------------------------------------------------
-- 2) A conversa
-- -----------------------------------------------------------------------------
create table if not exists public.system_report_messages (
  id uuid primary key default gen_random_uuid(),
  -- ⚠️ A ORDEM É PELO `seq`, não pela hora. `now()` é a hora do INÍCIO da
  -- transação: "mudou para Resolvido" e a resposta que explica o porquê nascem
  -- no mesmo instante, e ordenar por hora os embaralharia.
  seq bigserial not null,
  report_id uuid not null references public.system_reports (id) on delete cascade,
  author_id uuid references public.profiles (id),
  kind text not null check (
    kind in ('resposta', 'complemento', 'situacao', 'reabertura')
  ),
  body text,
  status_from public.system_report_status,
  status_to public.system_report_status,
  created_at timestamptz not null default now(),
  -- Resposta, complemento e reabertura sem texto não dizem nada; só a linha de
  -- situação pode vir muda ("passou para Em análise").
  constraint system_report_messages_body_check check (
    kind = 'situacao' or (body is not null and btrim(body) <> '')
  )
);

comment on table public.system_report_messages is
  'A conversa de cada relato: respostas, complementos de quem relatou, mudanças de situação e reaberturas. Nada se apaga nem se edita.';

create index if not exists system_report_messages_report_idx
  on public.system_report_messages (report_id, seq);

alter table public.system_report_messages enable row level security;

-- Quem enxerga o relato enxerga a conversa. A subconsulta roda com a RLS de
-- quem pergunta (a 0247), então não existe uma segunda régua aqui para
-- discordar da primeira.
drop policy if exists "system_report_messages_select" on public.system_report_messages;
create policy "system_report_messages_select" on public.system_report_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.system_reports r where r.id = report_id
    )
  );

-- SEM política de escrita, de propósito: toda linha nasce pelas funções
-- abaixo ou pelo gatilho. Mensagem escrita direto na tabela poderia ter
-- autor trocado — e a conversa é o registro do que foi combinado.

-- -----------------------------------------------------------------------------
-- 3) O relógio e o registro da situação — por GATILHO
-- -----------------------------------------------------------------------------
-- ⚠️ POR QUE GATILHO E NÃO DENTRO DA FUNÇÃO DE RESPOSTA: a política de UPDATE
-- da 0247 deixa o Admin Master escrever na tabela por qualquer caminho. Se o
-- relógio morasse só na função, uma mudança feita por fora ficaria sem data e
-- sem linha na conversa — e o painel mediria errado sem ninguém saber.
create or replace function public.system_report_track_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();

    if new.status = 'em_analise' and new.analysis_started_at is null then
      new.analysis_started_at := now();
    end if;

    if new.status in ('resolvido', 'nao_e_defeito') then
      new.closed_at := now();
    else
      new.closed_at := null;
    end if;

    if old.status in ('resolvido', 'nao_e_defeito')
       and new.status in ('aberto', 'em_analise') then
      new.reopened_count := old.reopened_count + 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists system_report_track_status on public.system_reports;
create trigger system_report_track_status
  before update on public.system_reports
  for each row execute function public.system_report_track_status();

-- A linha da conversa sai DEPOIS da mudança, para só existir se ela gravou.
-- O texto que acompanha (o motivo da reabertura) chega por uma configuração
-- LOCAL da transação: assim a mudança e o motivo viram UMA linha, em vez de
-- uma linha muda seguida de outra com o texto.
create or replace function public.system_report_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(
    current_setting('risarte.report_status_note', true), ''
  )), '');
  v_kind text := 'situacao';
begin
  -- ⚠️ SEM `update OF status`: o gatilho de coluna olha as colunas que o
  -- COMANDO cita, e um `update` que muda o status por outro caminho passaria
  -- em branco (a lição da 1010).
  if new.status is distinct from old.status then
    if old.status in ('resolvido', 'nao_e_defeito')
       and new.status in ('aberto', 'em_analise')
       and v_note is not null then
      v_kind := 'reabertura';
    end if;

    insert into public.system_report_messages
      (report_id, author_id, kind, body, status_from, status_to)
    values
      (new.id, (select auth.uid()), v_kind,
       case when v_kind = 'reabertura' then v_note else null end,
       old.status, new.status);
  end if;
  return null;
end;
$$;

drop trigger if exists system_report_log_status on public.system_reports;
create trigger system_report_log_status
  after update on public.system_reports
  for each row execute function public.system_report_log_status();

-- -----------------------------------------------------------------------------
-- 4) A porta da resposta — agora ACRESCENTA, não sobrescreve
-- -----------------------------------------------------------------------------
-- Mesma assinatura da 0247 (a tela não muda de porta). O que muda:
--   * o texto vira MENSAGEM NOVA, e `answer` passa a ser só "a última", para
--     quem ainda lê a coluna;
--   * a marca de "já li" VOLTA a nulo a cada resposta nova — senão a segunda
--     resposta nunca acendia a boia de quem relatou;
--   * resposta vazia com a mesma situação é recusada: não há o que registrar.
create or replace function public.answer_system_report(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_texto text := nullif(btrim(coalesce(p_answer, '')), '');
  v_versao text := nullif(btrim(coalesce(p_resolved_version, '')), '');
  v_atual public.system_report_status;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  select status into v_atual
    from public.system_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  -- Encerrar sem dizer por quê é o que faz a equipe parar de relatar. A regra
  -- da 0247 continua: quem encerra, escreve — NESTA mensagem, não numa antiga.
  if p_status in ('resolvido', 'nao_e_defeito')
     and v_atual is distinct from p_status
     and v_texto is null then
    raise exception 'ANSWER_REQUIRED';
  end if;

  if v_texto is null and v_atual = p_status then
    raise exception 'NOTHING_TO_SAVE';
  end if;

  -- A situação primeiro: o gatilho registra a mudança antes da resposta, e a
  -- conversa fica na ordem em que as coisas aconteceram.
  update public.system_reports
     set status = p_status,
         resolved_version = coalesce(v_versao, resolved_version)
   where id = p_report_id;

  if v_texto is not null then
    insert into public.system_report_messages
      (report_id, author_id, kind, body)
    values
      (p_report_id, v_user, 'resposta', v_texto);

    update public.system_reports
       set answer = v_texto,
           answered_by = v_user,
           answered_at = now(),
           first_response_at = coalesce(first_response_at, now()),
           reporter_seen_answer_at = null
     where id = p_report_id;
  end if;
end;
$$;

revoke all on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) from public;
grant execute on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Quem relatou: complementar e reabrir
-- -----------------------------------------------------------------------------
-- Complementar só enquanto está aberto. Num relato encerrado, o texto novo
-- não entraria na fila de ninguém — e o caminho certo ali é reabrir, que
-- entra.
create or replace function public.add_system_report_comment(
  p_report_id uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_texto text := nullif(btrim(coalesce(p_body, '')), '');
  v_dono uuid;
  v_status public.system_report_status;
begin
  if v_texto is null then
    raise exception 'BODY_REQUIRED';
  end if;

  select reporter_id, status into v_dono, v_status
    from public.system_reports
   where id = p_report_id;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  -- Só quem relatou. O Admin Master responde pela porta dele, que é a que
  -- acende a boia de quem relatou.
  if v_dono is distinct from v_user then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status in ('resolvido', 'nao_e_defeito') then
    raise exception 'REPORT_CLOSED';
  end if;

  insert into public.system_report_messages (report_id, author_id, kind, body)
  values (p_report_id, v_user, 'complemento', v_texto);
end;
$$;

revoke all on function public.add_system_report_comment(uuid, text) from public;
grant execute on function public.add_system_report_comment(uuid, text) to authenticated;

-- Reabrir: só quem relatou, só o que foi encerrado, e SEMPRE com motivo.
-- Reabrir sem dizer o que falhou devolve a quem vai corrigir o mesmo problema
-- que ele achava ter resolvido, sem pista nenhuma do que faltou.
create or replace function public.reopen_system_report(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dono uuid;
  v_status public.system_report_status;
begin
  if v_motivo is null or length(v_motivo) < 10 then
    raise exception 'REASON_REQUIRED';
  end if;

  select reporter_id, status into v_dono, v_status
    from public.system_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_dono is distinct from v_user then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status not in ('resolvido', 'nao_e_defeito') then
    raise exception 'REPORT_NOT_CLOSED';
  end if;

  -- O motivo viaja até o gatilho e vira a linha "reabertura" da conversa.
  perform set_config('risarte.report_status_note', v_motivo, true);

  update public.system_reports
     set status = 'aberto'
   where id = p_report_id;

  perform set_config('risarte.report_status_note', '', true);
end;
$$;

revoke all on function public.reopen_system_report(uuid, text) from public;
grant execute on function public.reopen_system_report(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) "Já li" POR RELATO
-- -----------------------------------------------------------------------------
-- A 0252 marcava tudo como lido ao abrir a tela. Com a conversa, a etiqueta
-- "Resposta nova" precisa ficar no relato até a pessoa abrir AQUELE relato —
-- senão ela entra na lista, a etiqueta some de todos, e a resposta que ela não
-- leu fica igual às que leu.
--
-- Mesma porta estreita da 0252: uma coluna, só na linha de quem chamou.
create or replace function public.mark_system_report_seen(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return;
  end if;

  update public.system_reports
     set reporter_seen_answer_at = now()
   where id = p_report_id
     and reporter_id = v_user
     and answer is not null
     and reporter_seen_answer_at is null;
end;
$$;

revoke all on function public.mark_system_report_seen(uuid) from public;
grant execute on function public.mark_system_report_seen(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O passado entra na conversa
-- -----------------------------------------------------------------------------
-- Relato já respondido ganha a resposta que tinha como primeira mensagem, com
-- a data e o autor de quando foi dada. Sem isto, a conversa dos relatos
-- antigos nasceria vazia e pareceria que ninguém respondeu.
--
-- Só onde ainda não há conversa: rodar de novo não duplica.
insert into public.system_report_messages
  (report_id, author_id, kind, body, created_at)
select r.id, r.answered_by, 'resposta', r.answer, coalesce(r.answered_at, r.created_at)
  from public.system_reports r
 where r.answer is not null
   and btrim(r.answer) <> ''
   and not exists (
     select 1 from public.system_report_messages m where m.report_id = r.id
   );

-- O relógio dos antigos, com o que se sabe. O início da análise NÃO é
-- inventado: não houve registro dele, e o painel mostra "sem dado" em vez de
-- uma data de fantasia.
update public.system_reports
   set first_response_at = coalesce(first_response_at, answered_at),
       closed_at = case
         when status in ('resolvido', 'nao_e_defeito')
           then coalesce(closed_at, answered_at, created_at)
         else closed_at
       end,
       status_changed_at = coalesce(status_changed_at, answered_at)
 where answered_at is not null
   and (first_response_at is null
        or (status in ('resolvido', 'nao_e_defeito') and closed_at is null));
