@echo off
title Risarte - Servidor (NAO FECHE enquanto estiver usando o sistema)
cd /d "%~dp0"

rem ===========================================================================
rem  Sem acentos de proposito: o cmd do Windows usa outra tabela de caracteres
rem  e acento aqui vira simbolo estranho na tela.
rem ===========================================================================

rem --- O sistema ja esta no ar? ----------------------------------------------
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3000); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 goto subir

rem  Estava fechando a janela sozinho aqui, e parecia travamento. Agora explica
rem  e PERGUNTA: as duas situacoes reais sao "esqueci a aba" e "esta lento".
echo ============================================================
echo   O SISTEMA JA ESTA RODANDO nesta maquina.
echo ------------------------------------------------------------
echo   Existe outra janela preta aberta com o servidor. Ela precisa
echo   continuar aberta enquanto voce usa o sistema.
echo.
echo   [1] Abrir o sistema no navegador   (o normal)
echo   [2] REINICIAR o servidor           (use se estiver lento
echo                                        ou travando)
echo   [3] Nao fazer nada
echo ============================================================
echo.
choice /c 123 /n /m "Escolha 1, 2 ou 3: "
if errorlevel 3 exit /b
if errorlevel 2 goto reiniciar
start "" http://localhost:3000
exit /b

rem --- Reiniciar: derruba o servidor antigo e sobe outro ----------------------
rem  O servidor de desenvolvimento acumula memoria com o tempo (ja passou de
rem  2 GB aqui). Reiniciar de vez em quando e normal, nao e defeito.
:reiniciar
echo.
echo Encerrando o servidor antigo...
powershell -NoProfile -Command "$ids = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty OwningProcess -Unique; foreach ($id in $ids) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $id) -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $p.ParentProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }"
timeout /t 3 >nul
echo Servidor antigo encerrado. A janela antiga pode ser fechada.
echo.

:subir
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
rem  Em segundo plano porque o "npm run dev" abaixo segura esta janela ate o
rem  servidor parar. Tenta por 3 minutos: a primeira partida do dia demora mais.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 180; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3000); $c.Close(); Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Seconds 1 } }"

call npm run dev

echo.
echo O servidor parou. Pressione uma tecla para fechar.
pause >nul
