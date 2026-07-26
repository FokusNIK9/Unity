@echo off
setlocal EnableExtensions
title Game Builder - ChatGPT App

echo ==============================================
echo   Game Builder - запуск ChatGPT App
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден.
  echo Установи Node.js 20+ и запусти файл снова.
  pause
  exit /b 1
)

if not exist "%~dp0server.js" (
  echo ОШИБКА: start_game_builder.bat должен лежать рядом с server.js.
  pause
  exit /b 1
)

set "TUNNEL_EXE=%USERPROFILE%\Downloads\tunnel-client-v0.0.10-windows-amd64\tunnel-client.exe"
if not exist "%TUNNEL_EXE%" (
  set /p "TUNNEL_EXE=Укажи полный путь к tunnel-client.exe: "
)
if not exist "%TUNNEL_EXE%" (
  echo ОШИБКА: tunnel-client.exe не найден.
  pause
  exit /b 1
)

echo.
set /p "CONTROL_PLANE_API_KEY=Вставь Runtime API key (ввод не скрывается, ключ не сохраняется): "
if "%CONTROL_PLANE_API_KEY%"=="" (
  echo ОШИБКА: ключ не введён.
  pause
  exit /b 1
)
set /p "TUNNEL_ID=Вставь ID туннеля из Platform: "
if "%TUNNEL_ID%"=="" (
  echo ОШИБКА: ID туннеля не введён.
  pause
  exit /b 1
)

cd /d "%~dp0"
echo.
echo Устанавливаю зависимости...
call npm install --cache "%TEMP%\npm-cache"
if errorlevel 1 (
  echo ОШИБКА: npm install завершился с ошибкой.
  pause
  exit /b 1
)

echo.
echo Обновляю профиль туннеля...
"%TUNNEL_EXE%" init --force --profile two-field-analyzer --tunnel-id "%TUNNEL_ID%" --mcp-server-url http://127.0.0.1:8787/mcp
if errorlevel 1 (
  echo ОШИБКА: не удалось создать профиль.
  pause
  exit /b 1
)

echo.
echo Запускаю MCP-сервер в отдельном окне...
start "Game Builder MCP" cmd /k "cd /d "%~dp0" && npm start"
timeout /t 3 /nobreak >nul

echo Проверяю локальный MCP-сервер...
"%TUNNEL_EXE%" doctor --profile two-field-analyzer
if errorlevel 1 echo ВНИМАНИЕ: doctor сообщил предупреждение. Продолжаю запуск туннеля.

echo.
echo Запускаю туннель в отдельном окне...
start "OpenAI MCP Tunnel" cmd /k "set CONTROL_PLANE_API_KEY=%CONTROL_PLANE_API_KEY%&& cd /d "%~dp0" && "%TUNNEL_EXE%" run --profile two-field-analyzer"

echo.
echo Готово. Не закрывай окна Game Builder MCP и OpenAI MCP Tunnel.
echo После запуска открой ChatGPT и вызови приложение через +.
pause
