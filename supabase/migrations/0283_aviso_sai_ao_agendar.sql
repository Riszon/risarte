-- =============================================================================
-- 0283 — O AVISO DE AGENDAR SAI SOZINHO QUANDO O AGENDAMENTO EXISTE (OC-00080)
-- -----------------------------------------------------------------------------
-- Relato da recepção (23/09/2026): o pop-up "Fechamento! Iniciar tratamento"
-- tinha ABRIR AGENDA, JÁ AGENDEI e MARCAR TODOS COMO AGENDADOS — e os dois
-- últimos só marcavam o aviso como lido, sem ninguém conferir se existia
-- agendamento. Até "Abrir agenda" apagava o aviso no CLIQUE, antes de agendar.
-- O lembrete mais forte do sistema podia ser calado sem agendar ninguém. O
-- irmão "Agendar apresentação comercial" tinha o mesmo defeito.
--
-- Decisão do dono (27/09/2026): o aviso SÓ sai quando o agendamento é criado
-- — por qualquer caminho (pop-up, agenda, ficha). A tela deixa só "Abrir
-- agenda"; "Fechar" adia 15 minutos.
--
--   * agendamento "Início de Tratamento"   → apaga da tela os avisos
--     "Iniciar tratamento" daquele cliente;
--   * agendamento "Apresentação Comercial" → os avisos "agendar apresentação".
--
-- O aviso é reconhecido pelo LINK, que carrega o cliente nos dois formatos que
-- as funções gravam hoje: '/agenda?cliente=<id>' e '/prontuarios/<id>'
-- (conferido lendo o corpo ATUAL das 6 funções que criam esses avisos).
--
-- ⚠️ NADA É APAGADO: o aviso ganha `read_at` (lido), como qualquer aviso lido.
-- Continua na central de notificações.
--
-- Idempotente.
-- =============================================================================

create or replace function public._aviso_de_agendar_resolvido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo text;
begin
  -- Só agendamento VIVO resolve o aviso: um criado já cancelado não agendou
  -- ninguém.
  if new.status not in ('scheduled', 'confirmed', 'completed') then
    return new;
  end if;

  v_titulo := case new.type
    when 'treatment_start' then '%iniciar tratamento%'
    when 'commercial_presentation' then '%agendar apresenta%'
    else null
  end;
  if v_titulo is null then return new; end if;

  -- SECURITY DEFINER de propósito: quem agenda (ex.: a SDR) resolve o aviso
  -- de OUTRAS pessoas (a recepção) — o RLS de notifications só deixa cada um
  -- mexer no próprio.
  update public.notifications n
     set read_at = now()
   where n.read_at is null
     and n.title ilike v_titulo
     and n.link in (
       '/agenda?cliente=' || new.client_id::text,
       '/prontuarios/' || new.client_id::text
     )
     and n.created_at <= now();
  return new;
end;
$$;

-- Função de gatilho, interna: ninguém chama pela API (Regra 7).
revoke all on function public._aviso_de_agendar_resolvido()
  from public, anon, authenticated;

drop trigger if exists trg_aviso_de_agendar_resolvido on public.appointments;
create trigger trg_aviso_de_agendar_resolvido
  after insert or update of type, status on public.appointments
  for each row execute function public._aviso_de_agendar_resolvido();

-- Avisos que já estão em aberto de clientes que JÁ TÊM o agendamento, criado
-- depois do aviso: saem agora (é o que o gatilho teria feito). Lidos, não
-- apagados.
update public.notifications n
   set read_at = now()
 where n.read_at is null
   and (n.title ilike '%iniciar tratamento%' or n.title ilike '%agendar apresenta%')
   and exists (
     select 1
     from public.appointments a
     where a.status in ('scheduled', 'confirmed', 'completed')
       and a.created_at >= n.created_at
       and a.type = case
             when n.title ilike '%iniciar tratamento%' then 'treatment_start'::public.appointment_type
             else 'commercial_presentation'::public.appointment_type
           end
       and n.link in (
         '/agenda?cliente=' || a.client_id::text,
         '/prontuarios/' || a.client_id::text
       )
   );
