-- =============================================================================
-- 0248 — As TENTATIVAS de realizar a apresentação comercial
-- -----------------------------------------------------------------------------
-- Pedido do dono (05/09/2026): entre "o plano foi enviado ao Comercial" e "a
-- apresentação aconteceu" existe um pedaço de vida que o sistema não enxergava.
-- O cliente não comparece; pede para remarcar; o consultor espera e nada. Hoje
-- isso não deixa rastro nenhum — o cartão fica parado em "A apresentar" e a
-- única memória do que houve está na cabeça do consultor.
--
-- ⚠️ NÃO CRIA HISTÓRICO NOVO. Os acontecimentos entram em
-- `commercial_card_events`, que já é o histórico do funil e já aparece no botão
-- "Histórico do funil" do cockpit. Uma segunda linha do tempo para o mesmo
-- cliente seria duas versões da mesma história, e a hora em que elas
-- divergissem seria justamente a hora de explicar o caso para alguém.
--
-- ⚠️ TIPO + TEXTO, NÃO SÓ TEXTO. Cada acontecimento tem um tipo, porque é o
-- tipo que deixa o sistema CONTAR: o cartão passa a dizer "3ª tentativa · 2 não
-- comparecimentos", e o caso difícil aparece sozinho no quadro. Texto livre
-- registra e não conta — vira um diário que ninguém relê.
--
-- ⚠️ NADA SE APAGA. Registro é histórico: para corrigir, acrescenta-se outro.
-- Mesma regra do financeiro.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Registrar um acontecimento da apresentação
-- -----------------------------------------------------------------------------
-- Os três primeiros tipos são TENTATIVA FRUSTRADA — é o que o cartão conta.
-- "contato" não é tentativa (falar com o cliente não é tentar apresentar), e
-- misturá-los inflaria o número justamente onde ele precisa ser confiável.
create or replace function public.log_presentation_event(
  p_client_id uuid,
  p_kind text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
  v_clinic uuid;
  v_label text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_label := case p_kind
    when 'apresentacao_nao_compareceu'      then 'Cliente não compareceu à apresentação'
    when 'apresentacao_cliente_remarcou'    then 'Cliente pediu para remarcar a apresentação'
    when 'apresentacao_consultor_remarcou'  then 'Apresentação remarcada pelo consultor'
    when 'apresentacao_contato'             then 'Contato com o cliente'
    when 'apresentacao_observacao'          then 'Observação'
    else null
  end;
  if v_label is null then
    raise exception 'INVALID_KIND';
  end if;

  select c.id, c.clinic_id into v_card_id, v_clinic
  from public.commercial_cards c
  where c.client_id = p_client_id;
  if v_card_id is null then
    raise exception 'CARD_NOT_FOUND';
  end if;

  -- Quem registra é o time comercial (Admin, Consultor, Assistente com escopo).
  -- Gerente e Franqueado enxergam o funil, mas não escrevem nele.
  if not public.commercial_is_team(v_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- "Observação" sem texto não diz nada a ninguém — e é a única em que o
  -- rótulo sozinho não informa.
  if p_kind = 'apresentacao_observacao' and v_note is null then
    raise exception 'NOTE_REQUIRED';
  end if;

  perform public.commercial_log_card_event(
    v_card_id,
    p_client_id,
    v_clinic,
    p_kind,
    v_label || case when v_note is null then '' else ': ' || v_note end
  );
end;
$$;

revoke all on function public.log_presentation_event(uuid, text, text) from public;
grant execute on function public.log_presentation_event(uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) Pedir à Recepção um novo agendamento de apresentação
-- -----------------------------------------------------------------------------
-- Irmã de `request_session_scheduling` (0107), que faz o mesmo para o Dentista.
-- Mesmo caminho de propósito: a Recepção já conhece esse aviso, e um segundo
-- mecanismo para "alguém está pedindo agendamento" seria mais uma caixa de
-- entrada para ela vigiar.
--
-- O pedido VAI PARA A UNIDADE DO CLIENTE, não para a Franqueadora: quem tem a
-- agenda e o telefone do paciente é a recepção da unidade.
create or replace function public.request_presentation_scheduling(
  p_client_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_requester text;
  v_title text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_card_id uuid;
begin
  select cl.clinic_id, cl.full_name into v_clinic, v_name
  from public.clients cl where cl.id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not public.commercial_is_team(v_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;

  select c.id into v_card_id
  from public.commercial_cards c where c.client_id = p_client_id;
  if v_card_id is null then raise exception 'CARD_NOT_FOUND'; end if;

  select p.full_name into v_requester
  from public.profiles p where p.id = (select auth.uid());

  v_title := 'Agendar apresentação: ' || v_name;

  -- DEDUPLICADO POR DIA. Dois cliques não podem virar dois avisos: a recepção
  -- passaria a filtrar a lista dela por conta própria, e aí perde o que
  -- importa junto com o que se repete.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, v_title,
         coalesce(v_requester, 'O Comercial')
           || ' pediu um novo agendamento de apresentação comercial para '
           || v_name || '.'
           || case when v_reason is null then '' else ' Motivo: ' || v_reason end,
         '/prontuarios/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic
    and ucr.role = 'receptionist'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.title = v_title
        and n.created_at >= public.today_br()
    );

  -- O PEDIDO ENTRA NO HISTÓRICO. Sem isto, "eu pedi" contra "não recebi" não
  -- tem como ser resolvido — e é a conversa que sempre acontece.
  perform public.commercial_log_card_event(
    v_card_id, p_client_id, v_clinic,
    'apresentacao_pedido_agendamento',
    'Novo agendamento solicitado à Recepção'
      || case when v_reason is null then '' else ': ' || v_reason end
  );
end;
$$;

revoke all on function public.request_presentation_scheduling(uuid, text) from public;
grant execute on function public.request_presentation_scheduling(uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A agenda avisa o histórico
-- -----------------------------------------------------------------------------
-- Quando a Recepção marca (ou remarca) a apresentação, o cartão já passa a
-- mostrar sozinho — ele lê a agenda. Mas o HISTÓRICO precisa da linha, senão a
-- sequência de tentativas fica com buracos: três "não compareceu" seguidos sem
-- nada entre eles não conta a história de que houve remarcação no meio.
--
-- Gatilho, e não chamada na tela: a apresentação pode ser marcada por caminhos
-- diferentes, e um deles esqueceria de avisar. **Ouve INSERT e UPDATE** — a
-- lição da 0218: há fluxo que nasce pronto, e remarcar é um update.
create or replace function public.presentation_appointment_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
  v_clinic uuid;
  v_quando text;
begin
  if new.type <> 'commercial_presentation' then return new; end if;
  if new.status in ('cancelled', 'no_show') then return new; end if;

  -- No UPDATE, só interessa quando o HORÁRIO mudou. Confirmar presença ou
  -- trocar uma observação não é remarcação, e registrar tudo encheria o
  -- histórico de linhas que não contam nada.
  if tg_op = 'UPDATE' and old.starts_at = new.starts_at then
    return new;
  end if;

  select c.id, c.clinic_id into v_card_id, v_clinic
  from public.commercial_cards c where c.client_id = new.client_id;
  if v_card_id is null then return new; end if;

  v_quando := to_char(
    new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY às HH24:MI'
  );

  perform public.commercial_log_card_event(
    v_card_id, new.client_id, v_clinic,
    'apresentacao_agendada',
    case when tg_op = 'INSERT' then 'Apresentação agendada para '
         else 'Apresentação remarcada para ' end || v_quando
  );
  return new;
end;
$$;

drop trigger if exists presentation_appointment_logged on public.appointments;
create trigger presentation_appointment_logged
  after insert or update on public.appointments
  for each row execute function public.presentation_appointment_logged();
