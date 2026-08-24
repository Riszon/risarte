@echo off
title Risarte - Conferencia das telas
cd /d "%~dp0"

rem ===========================================================================
rem  Sem acentos de proposito: o cmd usa outra tabela de caracteres.
rem
rem  Isto NAO e SQL e NAO vai no Supabase. Roda aqui no computador.
rem  Abre cada tela do sistema so para ver se ela responde. Nao muda nada.
rem ===========================================================================

echo ============================================================
echo   CONFERENCIA DAS TELAS
echo ------------------------------------------------------------
echo   Abre todas as telas do sistema, uma a uma, com o acesso de
echo   cada tipo de usuario, e diz quais quebraram ou barraram
echo   quem nao devia.
echo.
echo   PRECISA DO SERVIDOR ABERTO: se o "Iniciar Risarte" nao
echo   estiver rodando, abra ele primeiro e espere a pagina do
echo   sistema aparecer.
echo.
echo   SO LEITURA - nao altera nada, e seguro rodar quando quiser.
echo   Demora alguns minutos.
echo ============================================================
echo.

call npm run check:telas

echo.
if errorlevel 1 (
  echo ============================================================
  echo   ATENCAO: alguma tela FALHOU.
  echo   Copie o texto acima e mande para o assistente.
  echo ============================================================
) else (
  echo ============================================================
  echo   Tudo certo. Nenhuma tela falhou.
  echo ============================================================
)

echo.
echo Pressione uma tecla para fechar.
pause >nul
