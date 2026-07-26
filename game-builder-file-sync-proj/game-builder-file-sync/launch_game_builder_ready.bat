@echo off
setlocal

cd /d "%~dp0"

if "%CONTROL_PLANE_API_KEY%"=="" (
    echo ERROR: CONTROL_PLANE_API_KEY is not set in Windows.
    echo Set it once, then open a new terminal.
    pause
    exit /b 1
)

set "TUNNEL_ID=tunnel_6a5fd7d96b388191a4e271ffc71fe906"
set "TUNNEL_EXE=%~dp0..\tunnel-client-v0.0.10-windows-amd64\tunnel-client.exe"

if not exist "%TUNNEL_EXE%" (
    echo ERROR: tunnel-client.exe was not found:
    echo "%TUNNEL_EXE%"
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm is not installed or not in PATH.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo Initializing tunnel profile...
"%TUNNEL_EXE%" init --force --profile two-field-analyzer --tunnel-id "%TUNNEL_ID%" --mcp-server-url http://127.0.0.1:8787/mcp

echo Starting Game Builder MCP...
start "Game Builder MCP" /D "%~dp0" cmd.exe /k npm start

timeout /t 2 /nobreak >nul

echo Starting OpenAI tunnel...
start "OpenAI tunnel" /D "%~dp0" cmd.exe /k ""%TUNNEL_EXE%" run --profile two-field-analyzer"

echo.
echo Game Builder started.
echo Keep both windows open.
timeout /t 3 /nobreak >nul
exit /b 0
