@echo off
REM Double-click this file to refresh the finance_db database
REM from the SEC EDGAR API (loads any new tickers in WATCHLIST).
cd /d "%~dp0\.."
"C:\Users\co149\AppData\Roaming\kimi-desktop\daimon-share\daimon\runtime\python\.venv\Scripts\python.exe" loaders\02_load_sec_data.py
echo.
pause
