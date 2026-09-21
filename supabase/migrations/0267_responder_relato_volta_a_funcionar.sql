-- 0267 — RESPONDER UM RELATO VOLTA A FUNCIONAR
--
-- Defeito achado pelo dono em 21/09/2026: em /problemas, responder ou mudar a
-- situação devolvia "Você não tem permissão para isto." — com ele sendo Admin
-- Master, nos DOIS ambientes. Está assim desde a 0264 (19/09).
--
-- A CAUSA, medida e não deduzida: `is_admin_master()` devolvia true sob o
-- login dele, mas `answer_system_report` recusava. A recusa vinha de dentro,
-- em `answer_system_report_como`, que perguntava o PAPEL DA REQUISIÇÃO
-- (`mirror_writer_role()`) para saber por qual porta a chamada entrou. O papel
-- continua 'authenticated' quando uma função chama outra — inclusive em
-- security definer —, então a porta legítima batia na trava.
--
-- É a mesma família de erro que o CLAUDE.md §0d já registra: a régua media uma
-- coisa parecida com a que importava, e respondeu "não" com confiança.
--
-- A separação correta já existia e não dependia de palpite: `_como` nunca foi
-- concedida a 'authenticated'. Aqui a trava por papel sai e o privilégio fica
-- explícito — inclusive tirando 'anon', que tinha execute por herança e, sem a
-- trava, poderia responder em nome de um Admin sem nem estar logado.

create or replace function public.answer_system_report_como(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text,
  p_autor uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_texto text := nullif(btrim(coalesce(p_answer, '')), '');
  v_versao text := nullif(btrim(coalesce(p_resolved_version, '')), '');
  v_atual public.system_report_status;
  v_id uuid;
begin
  -- 0267: AQUI HAVIA UMA TRAVA QUE MEDIA A COISA ERRADA.
  -- Ela recusava quando o papel da requisição era 'authenticated' — querendo
  -- dizer "só o servidor escolhe o autor". Só que o papel da requisição NÃO
  -- MUDA quando uma função chama a outra: a porta da tela
  -- (`answer_system_report`, que já exigiu Admin Master) caía na própria
  -- trava, e RESPONDER PELA TELA NUNCA FUNCIONOU, nos dois ambientes.
  -- Quem separa as duas portas é o PRIVILÉGIO, não um palpite sobre o papel:
  -- esta função não é concedida a 'authenticated' nem a 'anon' (ver o revoke
  -- no fim do arquivo), então de fora só a chave de serviço entra. A conferência
  -- de que o autor é Admin Master continua logo abaixo.

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

-- A PORTA DE DENTRO É SÓ DO SERVIDOR: quem escolhe o autor da resposta é a
-- chave de serviço (o servidor da produção respondendo um relato do treino).
revoke all on function public.answer_system_report_como(uuid, public.system_report_status, text, text, uuid) from public;
revoke all on function public.answer_system_report_como(uuid, public.system_report_status, text, text, uuid) from anon;
revoke all on function public.answer_system_report_como(uuid, public.system_report_status, text, text, uuid) from authenticated;
grant execute on function public.answer_system_report_como(uuid, public.system_report_status, text, text, uuid) to service_role;

-- A PORTA DA TELA continua sendo a de sempre, e quem não está logado não entra.
revoke all on function public.answer_system_report(uuid, public.system_report_status, text, text) from anon;
grant execute on function public.answer_system_report(uuid, public.system_report_status, text, text) to authenticated;
