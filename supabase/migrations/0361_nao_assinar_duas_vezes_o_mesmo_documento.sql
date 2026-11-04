-- 0361 — NÃO DÁ PARA ASSINAR DUAS VEZES O MESMO DOCUMENTO (AP108, decisão do dono, 04/11/2026)
--
-- No teste real da ZS8, com o ASS-000049 (contrato + TCLE) aguardando
-- assinatura, a janela deixou mandar de novo os mesmos documentos ao mesmo
-- paciente (ASS-000050). Para a ZapSign são dois documentos diferentes: assinar
-- um não trava o outro, e o paciente poderia assinar os dois.
--
-- Decisão do dono: "não pode ter o risco de assinar duas vezes o mesmo
-- documento". O banco passa a recusar, nos dois momentos em que dá para
-- duplicar:
--   1. ao CRIAR o pacote (cada documento gravado em signature_package_items):
--      se já existe pacote AGUARDANDO assinatura (enviado ou parcialmente
--      assinado) para o mesmo paciente — ou a mesma empresa/lead — com o mesmo
--      modelo de documento, recusa (OPEN_PACKAGE_EXISTS:<número>). Nenhum
--      rascunho nasce;
--   2. ao ENVIAR (rascunho → enviado): confere de novo. É o que pega dois
--      envios ao mesmo tempo (duplo clique, duas abas): uma trava por
--      paciente/empresa (advisory lock) faz um esperar o outro, e o segundo vê
--      o primeiro já enviado. A recusa aí desfaz a gravação, e o envio cancela
--      na ZapSign o documento que acabou de criar (caminho de falha que já
--      existia em enviarPacote).
--
-- O que NÃO é bloqueado (decisão do dono): mandar de novo um documento que JÁ
-- FOI ASSINADO (um contrato novo para um tratamento novo é legítimo) — a tela
-- avisa e pede confirmação. PDF avulso (sem modelo) não entra na conta.
--
-- Para substituir um envio aberto: cancelar o anterior (a tela oferece
-- "Cancelar o anterior e enviar este"). Cancelado não conta.
--
-- Idempotente: `create or replace` e `drop trigger if exists` + `create`.

-- O pacote aberto (de outro id) que já tem este modelo para a mesma parte.
create or replace function public._signature_open_conflict(
  p_package_id uuid, p_client_id uuid, p_company_id uuid, p_lead_id uuid, p_template_id uuid
)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select p.number
    from public.signature_packages p
    join public.signature_package_items i on i.package_id = p.id
   where p.id <> p_package_id
     and p.status in ('sent', 'partially_signed')
     and i.template_id = p_template_id
     and (   (p_client_id is not null and p.client_id = p_client_id)
          or (p_company_id is not null and p.company_id = p_company_id)
          or (p_lead_id is not null and p.lead_id = p_lead_id))
   order by p.created_at
   limit 1;
$function$;

revoke execute on function public._signature_open_conflict(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Uma trava por parte (paciente, empresa ou lead): dois envios simultâneos
-- para a mesma parte passam um de cada vez.
create or replace function public._signature_party_lock(p_client_id uuid, p_company_id uuid, p_lead_id uuid)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  select pg_advisory_xact_lock(hashtext('signature-party:' || coalesce(p_client_id, p_company_id, p_lead_id)::text));
$function$;

revoke execute on function public._signature_party_lock(uuid, uuid, uuid) from public, anon, authenticated;

-- 1. Na criação: cada documento com modelo.
create or replace function public.signature_items_no_duplicate_open()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pkg record;
  v_conflict text;
begin
  if new.template_id is null then
    return new;
  end if;
  select id, client_id, company_id, lead_id into v_pkg
    from public.signature_packages where id = new.package_id;
  if v_pkg.id is null or coalesce(v_pkg.client_id, v_pkg.company_id, v_pkg.lead_id) is null then
    return new;
  end if;
  perform public._signature_party_lock(v_pkg.client_id, v_pkg.company_id, v_pkg.lead_id);
  v_conflict := public._signature_open_conflict(v_pkg.id, v_pkg.client_id, v_pkg.company_id, v_pkg.lead_id, new.template_id);
  if v_conflict is not null then
    raise exception 'OPEN_PACKAGE_EXISTS:%', v_conflict;
  end if;
  return new;
end;
$function$;

revoke execute on function public.signature_items_no_duplicate_open() from public, anon, authenticated;

drop trigger if exists signature_items_no_duplicate_open on public.signature_package_items;
create trigger signature_items_no_duplicate_open
  before insert on public.signature_package_items
  for each row execute function public.signature_items_no_duplicate_open();

-- 2. No envio: rascunho → enviado.
create or replace function public.signature_packages_no_duplicate_open()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_template uuid;
  v_conflict text;
begin
  if not (old.status = 'draft' and new.status = 'sent') then
    return new;
  end if;
  if coalesce(new.client_id, new.company_id, new.lead_id) is null then
    return new;
  end if;
  perform public._signature_party_lock(new.client_id, new.company_id, new.lead_id);
  for v_template in
    select distinct i.template_id from public.signature_package_items i
     where i.package_id = new.id and i.template_id is not null
  loop
    v_conflict := public._signature_open_conflict(new.id, new.client_id, new.company_id, new.lead_id, v_template);
    if v_conflict is not null then
      raise exception 'OPEN_PACKAGE_EXISTS:%', v_conflict;
    end if;
  end loop;
  return new;
end;
$function$;

revoke execute on function public.signature_packages_no_duplicate_open() from public, anon, authenticated;

drop trigger if exists signature_packages_no_duplicate_open on public.signature_packages;
create trigger signature_packages_no_duplicate_open
  before update of status on public.signature_packages
  for each row execute function public.signature_packages_no_duplicate_open();

-- Conferência (rodar e olhar): 2 · 3 · 0
select
  (select count(*) from pg_trigger
    where tgname in ('signature_items_no_duplicate_open', 'signature_packages_no_duplicate_open')
      and not tgisinternal) as gatilhos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_signature_open_conflict', '_signature_party_lock', 'signature_items_no_duplicate_open')) as funcoes,
  (select count(*) from (
     select p.client_id, i.template_id
       from public.signature_packages p
       join public.signature_package_items i on i.package_id = p.id
      where p.status in ('sent', 'partially_signed') and i.template_id is not null and p.client_id is not null
      group by 1, 2 having count(distinct p.id) > 1) d) as duplicados_abertos_hoje;
