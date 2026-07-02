@echo off
REM Double-click launcher (Windows). Starts the local board-pack server and
REM opens it in your browser. First run installs dependencies (needs Python 3).
cd /d "%~dp0"

REM Find Python: prefer the "py" launcher (installed by python.org installers),
REM fall back to "python" (the Microsoft Store stub fails the version check).
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo.
  echo  Den vrethike Python 3 ston ypologisti.
  echo  1. Katevaste to apo:  https://www.python.org/downloads/
  echo  2. Stin egkatastasi epilexte "Add python.exe to PATH".
  echo  3. Xanakante diplo klik sto run.bat
  echo.
  pause
  exit /b 1
)

echo Elegxos / egkatastasi vivliothikon (mono stin proti ektelesi)...
%PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Apotyxia egkatastasis vivliothikon. Elegxte ti syndesi diktyou kai xanadokimaste.
  pause
  exit /b 1
)
%PY% -m playwright install chromium >nul 2>nul

echo.
echo  O server xekinaei kai o browser tha anoixei automata...
echo  (kleiste ayto to parathyro gia termatismo)
echo.
%PY% serve.py --open
pause
