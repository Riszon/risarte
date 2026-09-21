-- =============================================================================
-- 0264 — RESPONDER, DO SISTEMA REAL, UM RELATO QUE NASCEU NO TREINO
-- =============================================================================
--
-- Decisão do dono (19/09/2026): relatar é igual nos dois ambientes, e a visão
-- junta fica no sistema real — inclusive responder. O relato continua morando
-- no banco onde nasceu; o que atravessa é a RESPOSTA, escrita pelo servidor da
-- produção com a chave de serviço do treino (o mesmo caminho da cópia dos
-- Risartanos; o treino nunca alcança a produção).
--
-- O problema técnico: `answer_system_report` descobre o autor por `auth.uid()`
-- e exige `is_admin_master()`. Pela chave de serviço não há usuário logado —
-- as duas coisas falham. Duplicar a regra num script seria a armadilha de
-- sempre: duas cópias da mesma regra, que divergem na primeira mudança.
--
-- Então a regra fica em UM lugar só: `answer_system_report_como(..., p_autor)`.
--   * Pela tela: `answer_system_report` continua com a MESMA assinatura e o
--     MESMO retorno (o id da mensagem, que a 0257 usa para prender anexos), e
--     passa a ser uma casca fina que exige Admin Master e chama a de baixo.
--   * Pela cópia: só a CHAVE DE SERVIÇO escolhe o autor, e o autor precisa ser
--     Admin Master NAQUELE banco (o treino recebe essa marca da produção,
--     0260/0262) — senão um token comum responderia no nome de outra pessoa.
-- =============================================================================

create or replace function public.answer_system_report_como(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text,
  p_autor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := nullif(btrim(coalesce(p_answer, '')), '');
  v_versao text := nullif(btrim(coalesce(p_resolved_version, '')), '');
  v_atual public.system_report_status;
  v_id uuid;
begin
  -- Quem escolhe o autor é só a chave de serviço (o servidor da produção).
  -- Pela tela o caminho é `answer_system_report`, que exige Admin Master.
  if public.mirror_writer_role() in ('authenticated', 'anon') then
    raise exception 'NOT_ALLOWED';
  end if;

  -- E o autor tem de ser Admin Master aqui dentro.
  if not coalesce(
       (select p.is_admin_master from public.profiles p where p.id = p_autor),
       false) then
    raise exception 'NOT_ALLOWED';
  end if;

  select status into v_atual
    from public.system_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  -- As MESMAS regras de sempre: encerrar sem dizer por quê, não; e salvar
  -- nada, também não.
  if p_status in ('resolvido', 'nao_e_defeito')
     and v_atual is distinct from p_status
     and v_texto is null then
    raise exception 'ANSWER_REQUIRED';
  end if;

  if v_texto is null and v_atual = p_status then
    raise exception 'NOTHING_TO_SAVE';
  end if;

  update public.system_reports
     set status = p_status,
         resolved_version = coalesce(v_versao, resolved_version)
   where id = p_report_id;

  if v_texto is not null then
    insert into public.system_report_messages
      (report_id, author_id, kind, body)
    values
      (p_report_id, p_autor, 'resposta', v_texto)
    returning id into v_id;

    update public.system_reports
       set answer = v_texto,
           answered_by = p_autor,
           answered_at = now(),
           first_response_at = coalesce(first_response_at, now()),
           reporter_seen_answer_at = null
     where id = p_report_id;
  end if;

  -- Nulo quando só a situação mudou: não há mensagem para prender anexo.
  return v_id;
end;
$$;

revoke all on function public.answer_system_report_como(
  uuid, public.system_report_status, text, text, uuid
) from public;
revoke all on function public.answer_system_report_como(
  uuid, public.system_report_status, text, text, uuid
) from authenticated;

-- A porta da TELA: mesma assinatura e mesmo retorno da 0257.
create or replace function public.answer_system_report(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.answer_system_report_como(
    p_report_id, p_status, p_answer, p_resolved_version, (select auth.uid())
  );
end;
$$;

revoke all on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) from public;
grant execute on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) to authenticated;
