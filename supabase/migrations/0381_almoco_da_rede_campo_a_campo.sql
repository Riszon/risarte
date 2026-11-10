-- =============================================================================
-- 0381 — O ALMOÇO DA REDE VALE PARA A UNIDADE QUE NÃO DEFINIU O DELA (AP98)
--
-- DECISÃO DO DONO (10/11/2026): a configuração da agenda cai da unidade para
-- a rede CAMPO A CAMPO. "O que a unidade não definiu (por exemplo o almoço)
-- vem da rede; o que ela definiu, vale o dela."
--
-- O QUE ESTAVA ERRADO: a cascata era pela LINHA inteira. Bastava a unidade ter
-- horário de funcionamento próprio para perder o almoço da rede — e a tela do
-- almoço da rede dizia que "cada unidade herda automaticamente".
--
-- POR QUE PRECISA DE MIGRAÇÃO: `lunch_enabled` era obrigatório, com padrão
-- `false`. Não havia como dizer "a unidade não decidiu" — toda linha de
-- unidade nascia dizendo "sem almoço".
--
-- O QUE MUDA:
--   1) `lunch_enabled` passa a aceitar NULO = "segue o almoço da rede";
--   2) as unidades que hoje estão com `false` (sem almoço) passam a NULO.
--      Enquanto a rede não tiver almoço ligado, NADA muda para elas. Onde a
--      rede tem almoço, a unidade passa a ter o almoço da rede — é a
--      consequência que o dono aceitou ao decidir. A unidade que quiser ficar
--      SEM almoço desmarca "Seguir o padrão da rede" em Agenda → Configuração.
--   3) unidade com almoço PRÓPRIO ligado (`true`) não é tocada.
--
-- ⚠️ A linha da REDE (clinic_id nulo) não muda: nela, nulo não faria sentido.
-- Nada é apagado. Os horários de almoço gravados continuam nas colunas.
-- Idempotente: a troca acontece só na primeira vez que roda.
-- =============================================================================

-- CONFERÊNCIA ANTES DE MUDAR (só leitura; vale na PRIMEIRA vez que roda): as
-- unidades cujo almoço passa a ser o da rede. `muda_na_pratica` = true só onde a rede tem almoço ligado.
select
  c.name as unidade,
  'sem almoço' as hoje,
  case when coalesce(r.lunch_enabled, false)
       then 'almoço da rede ' || to_char(r.lunch_start, 'HH24:MI') || '–' || to_char(r.lunch_end, 'HH24:MI')
       else 'sem almoço (a rede não tem)' end as depois,
  coalesce(r.lunch_enabled, false) as muda_na_pratica
from public.clinic_agenda_settings s
join public.clinics c on c.id = s.clinic_id
left join public.clinic_agenda_settings r on r.clinic_id is null
where s.clinic_id is not null and s.lunch_enabled = false
order by c.name;

-- ⚠️ SÓ NA PRIMEIRA VEZ (enquanto a coluna ainda é obrigatória). Rodar de
-- novo NÃO desfaz a escolha de uma unidade que, depois, decidiu ficar sem
-- almoço (`false` gravado de propósito).
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.clinic_agenda_settings'::regclass
      and attname = 'lunch_enabled' and attnotnull
  ) then
    alter table public.clinic_agenda_settings
      alter column lunch_enabled drop not null,
      alter column lunch_enabled drop default;

    update public.clinic_agenda_settings
       set lunch_enabled = null
     where clinic_id is not null
       and lunch_enabled = false;
  end if;
end $$;

comment on column public.clinic_agenda_settings.lunch_enabled is
  'Almoço: true = a unidade fecha no almoço dela; false = a unidade decidiu não ter almoço; NULO (só em linha de unidade) = não definiu, segue o almoço da rede (AP98, 0381). Na linha da rede (clinic_id nulo) é sempre true/false.';

-- A rede nunca fica sem resposta.
update public.clinic_agenda_settings
   set lunch_enabled = false
 where clinic_id is null
   and lunch_enabled is null;

-- CONFERÊNCIA FINAL (só leitura). Esperado na primeira vez:
-- unidades_sem_almoco_gravado = 0.
select
  count(*) filter (where clinic_id is not null and lunch_enabled is null) as unidades_que_seguem_a_rede,
  count(*) filter (where clinic_id is not null and lunch_enabled = true) as unidades_com_almoco_proprio,
  count(*) filter (where clinic_id is not null and lunch_enabled = false) as unidades_sem_almoco_gravado,
  bool_or(lunch_enabled) filter (where clinic_id is null) as rede_tem_almoco
from public.clinic_agenda_settings;
