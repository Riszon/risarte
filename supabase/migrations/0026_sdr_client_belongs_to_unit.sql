-- =============================================================================
-- Risarte Odontologia — Migration 0026 (LOTE E — Opção A)
-- Cliente cadastrado pela SDR passa a PERTENCER À UNIDADE escolhida (não mais
-- à Franqueadora). Isso conserta de uma vez: anexar/ler arquivos clínicos,
-- aparecer na Jornada da unidade, mover de fase e mostrar a unidade certa.
-- O CÓDIGO continua com o prefixo da Franqueadora (FRA-xxxxx) — gerado no app
-- pela função next_client_code(Franqueadora) e preservado aqui.
-- Idempotente.
-- =============================================================================

-- 1) INSERT de clientes: Recepcionista da unidade, OU a SDR (Encantador) com
--    acesso à unidade, OU Admin. (Antes só checava papel NA clínica do clinic_id,
--    o que impedia a SDR de criar o cliente direto na unidade.)
drop policy if exists "clients_insert_receptionist" on public.clients;
create policy "clients_insert_receptionist"
  on public.clients for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

-- 2) Migra os clientes existentes que estão "na Franqueadora" com unidade de
--    preferência: passam a pertencer à unidade (mantendo o código FRA já gerado).
update public.clients c
set clinic_id = c.preferred_clinic_id,
    preferred_clinic_id = null
where c.preferred_clinic_id is not null
  and c.clinic_id in (select id from public.clinics where type = 'franchisor');
