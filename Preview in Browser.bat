@echo off
cd /d "%~dp0"
py -3 scripts\preview.py
if errorlevel 1 pause
