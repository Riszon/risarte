-- =============================================================================
-- 0265 — AS BOAS-VINDAS APARECEM NOS 3 PRIMEIROS ACESSOS
-- =============================================================================
--
-- Pedido do dono (20/09/2026): *"coloque para aparecer nos 3 primeiros logins
-- de cada usuário"*. Uma vez só é pouco: quem chega tem muita coisa nova na
-- frente e fecha a janela sem ler.
--
-- COMO SE CONTA, e por que não é exatamente "login": o sistema não guarda uma
-- contagem de entradas. O que ele vê é a tela de Início sendo aberta. Contar
-- cada abertura gastaria as três em dez minutos no primeiro dia — então conta
-- **uma vez por dia**: no máximo três dias diferentes. Na prática é o que o
-- dono pediu (os primeiros acessos), sem depender de um dado que não existe.
--
--   * `welcome_count`  — quantas vezes já apareceu (para em 3);
--   * `welcomed_at`    — quando apareceu pela última vez (já existia, 0263).
--
-- Quem JÁ tinha visto (0263) fica com a contagem cheia: a equipe atual não
-- volta a receber as boas-vindas por causa desta mudança. Para alguém ver de
-- novo, basta zerar a contagem daquela pessoa.
-- =============================================================================

alter table public.profiles
  add column if not exists welcome_count integer not null default 0;

update public.profiles
   set welcome_count = 3
 where welcomed_at is not null
   and welcome_count = 0;
