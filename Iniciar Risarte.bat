@echo off
title Risarte - Servidor (NAO FECHE enquanto estiver usando o sistema)
cd /d "%~dp0"
echo ============================================================
echo   RISARTE ODONTOLOGIA - servidor de desenvolvimento
echo ------------------------------------------------------------
echo   Aguarde aparecer "Ready" e abra no navegador:
echo.
echo        http://localhost:3000
echo.
echo   Para DESLIGAR o sistema: feche esta janela.
echo   NAO feche enquanto estiver usando.
echo ============================================================
echo.
call npm run dev
echo.
echo O servidor parou. Pressione uma tecla para fechar.
pause >nul
