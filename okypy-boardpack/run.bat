@echo off
REM Double-click launcher (Windows). Starts the local board-pack server and
REM opens it in your browser. First run installs dependencies (needs Python 3).
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Xreiazetai Python 3. Egkatastiste to apo https://www.python.org kai xanadokimaste.
  pause
  exit /b 1
)

echo Elegxos/egkatastasi vivliothikon...
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
python -m playwright install chromium >nul 2>nul

start "" http://localhost:8000
echo Anoigma http://localhost:8000 ...  (kleiste auto to parathyro gia termatismo)
python serve.py
