@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
where py >nul 2>nul
if %errorlevel%==0 (
  echo Iniciando Final Fight X Web em http://127.0.0.1:%PORT%/
  start "" "http://127.0.0.1:%PORT%/?diagnostics=1"
  py -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  echo Iniciando Final Fight X Web em http://127.0.0.1:%PORT%/
  start "" "http://127.0.0.1:%PORT%/?diagnostics=1"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
echo.
echo Python 3 nao foi encontrado.
echo Publique a pasta no GitHub Pages ou instale Python 3.
echo Nao abra index.html diretamente por file://.
echo.
pause
