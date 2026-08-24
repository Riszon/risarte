@echo off
title Risarte - Conferencia do sistema
cd /d "%~dp0"

rem ===========================================================================
rem  Sem acentos de proposito: o cmd usa outra tabela de caracteres.
rem
rem  Isto NAO e SQL e NAO vai no Supabase. Roda aqui no computador e le o banco
rem  so para conferir. Nao muda nada.
rem ===========================================================================

echo ============================================================
echo   CONFERENCIA DO SISTEMA
echo ------------------------------------------------------------
echo   Le o banco e confere se as contas batem entre si:
echo   razao, estoque, compras e taxas.
echo.
echo   SO LEITURA - nao altera nada, e seguro rodar quando quiser.
echo ============================================================
echo.

call npm run check:dados

echo.
if errorlevel 1 (
  echo ============================================================
  echo   ATENCAO: alguma conferencia FALHOU.
  echo   Copie o texto acima e mande para o assistente.
  echo ============================================================
) else (
  echo ============================================================
  echo   Tudo certo. Nenhuma conta divergiu.
  echo ============================================================
)

echo.
echo Pressione uma tecla para fechar.
pause >nul
