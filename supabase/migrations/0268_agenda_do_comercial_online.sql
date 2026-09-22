-- =============================================================================
-- 0268 — A AGENDA DO COMERCIAL ONLINE NÃO É A AGENDA DA UNIDADE
-- =============================================================================
-- Relato OC-00072 (Admin Master, 22/09/2026): *"por ser um atendimento online
-- não depende exclusivamente do atendimento da unidade... o consultor pode
-- atender diversas unidades por trabalhar de maneira remota, não sendo afetado
-- pelo horário de funcionamento de unidade"*.
--
-- O QUE O SISTEMA JÁ FAZIA — e por que isto é buraco, não regra. A apresentação
-- comercial (online) já era tratada como diferente em três pontos: não ocupa
-- sala, não respeita o almoço e não conta cadeira. Faltava o quarto: ela ainda
-- era recusada fora do horário da unidade e nos dias em que a unidade fecha.
-- Ninguém nunca escreveu que deveria ser assim; a configuração da agenda (0043)
-- nasceu pensando em cadeira e sala, que é o que o online não usa.
--
-- A FORMA É A CASCATA DE SEMPRE (SLA, preços, taxas): linha com `user_id` NULO
-- é o padrão da REDE; linha com `user_id` é a jornada daquele consultor.
-- Decisão do dono, 22/09/2026 — sem o padrão, todo consultor novo nasceria sem
-- horário nenhum e ninguém conseguiria marcar com ele.
--
-- ⚠️ COLUNAS ANULÁVEIS na linha do consultor, de propósito. A lição da 0230:
-- cascata com coluna NOT NULL + default nunca chega ao padrão da rede — a linha
-- do consultor nasceria com 08:00 congelado, e mudar a rede jamais o alcançaria.
-- Só a linha da REDE tem valores obrigatórios.

create table if not exists public.online_agenda_settings (
  id uuid primary key default gen_random_uuid(),
  -- NULO = padrão da rede; preenchido = a jornada daquele consultor.
  user_id uuid references public.profiles (id) on delete cascade,
  open_time time,
  close_time time,
  weekdays smallint[],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create unique index if not exists online_agenda_settings_user_key
  on public.online_agenda_settings (user_id) nulls not distinct;

alter table public.online_agenda_settings enable row level security;

-- Leitura para qualquer usuário autenticado: é configuração de agenda, não dado
-- de paciente — e a recepção precisa dela para oferecer os horários livres.
drop policy if exists "online_agenda_settings_select" on public.online_agenda_settings;
create policy "online_agenda_settings_select" on public.online_agenda_settings
  for select to authenticated using (true);

-- Escrita: Admin Master e Franqueadora (decisão do dono, 22/09/2026). O próprio
-- consultor NÃO muda a sua jornada — é decisão de gestão, e quem fecha a
-- própria agenda sem ninguém ver some do funil sem explicação.
drop policy if exists "online_agenda_settings_write" on public.online_agenda_settings;
create policy "online_agenda_settings_write" on public.online_agenda_settings
  for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer())
  with check (public.is_admin_master() or public.is_network_viewer());

-- O PADRÃO DA REDE, mais largo que o da unidade de propósito: quem atende
-- remoto costuma alcançar o cliente fora do horário comercial, que é quando o
-- cliente consegue conversar. Segunda a sábado, 08h às 20h.
insert into public.online_agenda_settings (user_id, open_time, close_time, weekdays)
values (null, '08:00', '20:00', '{1,2,3,4,5,6}')
on conflict (user_id) do nothing;

comment on table public.online_agenda_settings is
  'Jornada do atendimento ONLINE (apresentação comercial). Linha com user_id nulo = padrão da rede; linha com user_id = exceção daquele consultor. O online não depende do horário da unidade — só das férias e dos fechamentos que alcancem a própria pessoa (0268).';
