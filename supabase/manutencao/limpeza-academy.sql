-- =============================================================================
-- LIMPEZA DO RISARTE ACADEMY — zerar o conteúdo de teste (31/08/2026)
-- -----------------------------------------------------------------------------
-- ⚠️ ISTO NÃO É UMA MIGRAÇÃO. Mora em `manutencao/` pelo mesmo motivo do outro
-- arquivo daqui: a pasta `migrations/` é reaplicada inteira ao reconstruir o
-- sistema, e um arquivo que apaga dados vivendo lá seria uma bomba de efeito
-- retardado.
--
-- ⚠️ O ACADEMY DIVIDE O BANCO COM O riSZon. Ele vive no schema `treinamento`,
-- num repositório separado (`PROJETOS RISARTE/risarte-academy`), e compartilha
-- os logins pelo `auth.users`. **Este arquivo não encosta em nada fora do
-- `treinamento`** — nem no riSZon, nem no Empresarial, nem nos usuários.
--
-- Foi exatamente esse compartilhamento que passou despercebido na limpeza do
-- riSZon (28/08): apagar 19 usuários levou junto, por cascata, as matrículas e
-- os certificados do Academy. Decisão do dono ao saber: era tudo teste, e o
-- Academy vai recomeçar limpo — é o que este arquivo faz.
--
-- O QUE SAI: cursos, módulos, aulas, trilhas, provas, questões, tentativas,
-- certificados emitidos, progresso, pontos, mural, comentários e anotações.
--
-- O QUE FICA: as CONFIGURAÇÕES (modelo de certificado, regras de ranking,
-- ajustes do mural), o seu perfil de aluno e a sua permissão de administrador —
-- sem eles você teria de reconfigurar tudo antes de cadastrar o primeiro curso.
--
-- Roda em UMA transação: ou apaga tudo, ou não apaga nada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. ATIVIDADE DAS PESSOAS — o que foi feito nos cursos.
-- -----------------------------------------------------------------------------
-- Antes do conteúdo, para o efeito ser explícito em vez de arrastado por
-- cascata. Assim, se alguma tabela mudar de nome numa versão futura do Academy,
-- o erro aparece aqui e não em silêncio.
delete from treinamento.attempt_answer;
delete from treinamento.attempt_question;
delete from treinamento.attempt;
delete from treinamento.certificate;
delete from treinamento.progress;
delete from treinamento.enrollment;
delete from treinamento.points_ledger;
delete from treinamento.lesson_comment;
delete from treinamento.lesson_note;
delete from treinamento.feed_reaction;
delete from treinamento.feed_post;

-- -----------------------------------------------------------------------------
-- 2. O CONTEÚDO — cursos, trilhas e provas.
-- -----------------------------------------------------------------------------
-- `course` e `assessment` são as raízes: módulo → aula e questão → alternativa
-- saem por cascata, que é como o Academy foi desenhado.
delete from treinamento.content_target;
delete from treinamento.track_item;
delete from treinamento.track;

delete from treinamento.match_left;
delete from treinamento.match_right;
delete from treinamento.answer_option;
delete from treinamento.question;
delete from treinamento.assessment;

delete from treinamento.lesson;
delete from treinamento.module;
delete from treinamento.course;

-- -----------------------------------------------------------------------------
-- 3. OS PONTOS DE QUEM FICOU voltam a zero.
-- -----------------------------------------------------------------------------
-- `lms_profile.points` é um total acumulado, não uma soma calculada na hora:
-- apagar o extrato de pontos (passo 1) não zera o placar sozinho, e o ranking
-- abriria mostrando pontuação de um curso que não existe mais.
update treinamento.lms_profile set points = 0 where points <> 0;

commit;

-- =============================================================================
-- CONFERÊNCIA — o que ficou de pé.
-- =============================================================================
select 'cursos (esperado 0)'        as item, count(*) from treinamento.course
union all select 'aulas (esperado 0)',        count(*) from treinamento.lesson
union all select 'trilhas (esperado 0)',      count(*) from treinamento.track
union all select 'provas (esperado 0)',       count(*) from treinamento.assessment
union all select 'certificados (esperado 0)', count(*) from treinamento.certificate
union all select 'progresso (esperado 0)',    count(*) from treinamento.progress
union all select 'mural (esperado 0)',        count(*) from treinamento.feed_post
union all select 'config. do certificado',    count(*) from treinamento.certificate_settings
union all select 'config. do ranking',        count(*) from treinamento.ranking_settings
union all select 'config. do mural',          count(*) from treinamento.feed_settings
union all select 'perfis de aluno',           count(*) from treinamento.lms_profile
union all select 'permissões de admin',       count(*) from treinamento.lms_capability;
