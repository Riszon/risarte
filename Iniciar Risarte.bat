@echo off
title Risarte - Servidor (NAO FECHE enquanto estiver usando o sistema)
cd /d "%~dp0"

rem ===========================================================================
rem  Sem acentos de proposito: o cmd do Windows usa outra tabela de caracteres
rem  e acento aqui vira simbolo estranho na tela.
rem ===========================================================================

rem --- O sistema ja esta no ar? Entao so abre a pagina. -----------------------
rem  Subir um segundo servidor faria o Next escolher outra porta (3001), e o
rem  sistema apareceria em dois enderecos diferentes - com o navegador aberto
rem  em um e o servidor novo no outro.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3000); $c.Close(); exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo ============================================================
  echo   O sistema JA esta rodando.
  echo   Abrindo no navegador: http://localhost:3000
  echo ============================================================
  start "" http://localhost:3000
  timeout /t 3 >nul
  exit /b
)

echo ============================================================
echo   RISARTE ODONTOLOGIA - servidor de desenvolvimento
echo ------------------------------------------------------------
echo   O navegador abre sozinho assim que o sistema estiver pronto.
echo   Se nao abrir, use: http://localhost:3000
echo.
echo   Para DESLIGAR o sistema: feche esta janela.
echo   NAO feche enquanto estiver usando.
echo ============================================================
echo.

rem --- Abre o navegador quando o servidor responder --------------------------
rem  Roda em segundo plano porque o "npm run dev" abaixo segura esta janela ate
rem  o servidor parar. Tenta por 3 minutos; a primeira partida do dia demora
rem  mais porque o Next compila tudo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 180; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3000); $c.Close(); Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Seconds 1 } }"

call npm run dev

echo.
echo O servidor parou. Pressione uma tecla para fechar.
pause >nul
