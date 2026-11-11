-- =============================================================================
-- 0395 — ASSINATURA DIGITAL: O LINK DO PACIENTE E O PDF SÓ PELO SERVIDOR (AP152)
--
-- O QUE ESTAVA ERRADO (revisão de 11/11/2026, lido no SQL da 0340):
--   1) `signature_signers_select` entrega a LINHA INTEIRA a quem pode ver o
--      pacote. As telas nunca leem o link, mas qualquer pessoa logada com
--      "visualizar" (o Coordenador Clínico, por exemplo) conseguia pela API ler
--      o `sign_url` do paciente — o link pessoal de assinatura — e o CPF, o
--      telefone e o e-mail de cada signatário. Com autenticação simples, abrir
--      o link é poder assinar no lugar dele.
--   2) O balde `signature-documents` deixava LER (e gerar URL de download) a
--      quem só visualiza. Baixar o PDF assinado direto pelo armazenamento
--      pulava a permissão "baixar" e não ficava na Auditoria.
--
-- O QUE MUDA:
--   1) `signature_signers`: o logado lê só as colunas que as telas usam
--      (permissão por coluna). Ficam de fora `sign_url`,
--      `zapsign_signer_token`, `cpf`, `email` e `phone` — o servidor lê com a
--      chave de serviço DEPOIS de conferir a permissão (reenviar, reenviar como
--      novo). A regra de linha não muda. "Minhas assinaturas pendentes" segue
--      pela porta `signature_my_pending` (dono), que entrega o link de quem
--      assina para a própria pessoa.
--   2) Sai a regra de leitura do balde para logados: toda URL de PDF passa a ser
--      gerada pelo servidor (chave de serviço), que confere visualizar/baixar e
--      registra na Auditoria (`src/lib/signatures/pacote.ts`).
--
-- O app desta versão já não lê nada disso com a sessão da pessoa: pode subir
-- antes ou depois desta migração.
--
-- Idempotente: rodar de novo dá o mesmo resultado.
-- =============================================================================

-- 1) Signatários: leitura por coluna, sem os dados sensíveis.
revoke select on public.signature_signers from anon, authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'signature_signers'
     and column_name not in ('sign_url', 'zapsign_signer_token', 'cpf', 'email', 'phone');
  if v_cols is null then
    raise exception 'signature_signers sem colunas: nada para liberar';
  end if;
  execute format('grant select (%s) on public.signature_signers to authenticated', v_cols);
end
$$;

comment on table public.signature_signers is
  'ZS1: quem assina cada pacote, em que ordem e em que pé está. 0395: o logado lê só as colunas sem dado sensível (o link de assinatura, o token da ZapSign, CPF, e-mail e telefone ficam com o servidor).';

-- 2) Balde: sem leitura direta para logados (as URLs nascem no servidor).
drop policy if exists "signature_documents_select" on storage.objects;

-- Conferência (cole e rode à parte, depois):
-- select
--   has_column_privilege('authenticated', 'public.signature_signers', 'sign_url', 'select') as link_aberto,       -- false
--   has_column_privilege('authenticated', 'public.signature_signers', 'cpf', 'select') as cpf_aberto,             -- false
--   has_column_privilege('authenticated', 'public.signature_signers', 'status', 'select') as situacao_aberta,     -- true
--   (select count(*) from pg_policies where schemaname = 'storage' and policyname = 'signature_documents_select') as regra_do_balde; -- 0
