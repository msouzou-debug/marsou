@echo off
REM Double-click launcher (Windows). Starts the local board-pack server and
REM opens it in your browser. First run installs dependencies (needs Python 3).
cd /d "%~dp0"
set "PYTHONUTF8=1"

REM 1) Portable bundle: if a python\ folder ships next to this file, use it —
REM    nothing to install, no admin rights needed.
REM 2) Otherwise find an installed Python: the "py" launcher first, then
REM    "python" (the Microsoft Store stub fails the version probe).
set "PY="
set "BUNDLED="
if exist "python\python.exe" ( set "PY=python\python.exe" & set "BUNDLED=1" )
if not defined PY ( py -3 --version >nul 2>nul && set "PY=py -3" )
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo.
  echo  Den vrethike Python 3 ston ypologisti.
  echo  Epilogi A ^(xoris dikaiomata diaxeiristi^): katevaste to "portable"
  echo    paketo tou ergaleiou ^(periexei Python mesa^) kai xanatrexte to run.bat.
  echo  Epilogi B: egkatastiste Python 3 apo https://www.python.org/downloads/
  echo    ^(sto installer: "Install Now" xoris admin — ana xristi^).
  echo.
  pause
  exit /b 1
)

if defined BUNDLED (
  echo Xrisi tou ensomatomenou Python ^(portable^) — den xreiazetai egkatastasi.
) else (
  echo Elegxos / egkatastasi vivliothikon ^(mono stin proti ektelesi^)...
  %PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
  if errorlevel 1 (
    echo.
    echo  Apotyxia egkatastasis vivliothikon. Elegxte ti syndesi diktyou kai xanadokimaste.
    pause
    exit /b 1
  )
)
REM Chromium for PDF/PPTX (downloads once to the user profile — no admin).
%PY% -m playwright install chromium >nul 2>nul

echo.
echo  O server xekinaei kai o browser tha anoixei automata...
echo  (kleiste ayto to parathyro gia termatismo)
echo.
%PY% serve.py --open
pause
