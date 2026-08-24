@echo off
title Risarte - Assistir os testes
cd /d "%~dp0"

rem ===========================================================================
rem  Sem acentos de proposito: o cmd usa outra tabela de caracteres.
rem
rem  Abre o navegador e deixa VER o robo usando o sistema, devagar.
rem  Roda no BANCO DE TESTE (projeto separado) - nada encosta na producao.
rem ===========================================================================

echo ============================================================
echo   ASSISTIR OS TESTES
echo ------------------------------------------------------------
echo   Uma janela do navegador vai abrir sozinha e o robo vai
echo   usar o sistema na sua frente: cadastrar paciente, mover de
echo   fase, montar o plano, aprovar e fechar a venda.
echo.
echo   NAO MEXA no navegador enquanto ele trabalha - o clique dele
echo   e o seu disputam a mesma tela.
echo.
echo   Tudo acontece no BANCO DE TESTE. Nenhum dado de paciente
echo   de verdade e tocado.
echo.
echo   Demora alguns minutos. Para fechar antes, feche esta janela.
echo ============================================================
echo.

set SLOW_MO=350
call npx playwright test --headed

echo.
echo ============================================================
echo   Fim. O relatorio detalhado abre com:
echo     npx playwright show-report
echo ============================================================
echo.
echo Pressione uma tecla para fechar.
pause >nul
