@echo off
rem sd.bitech ping helper: real ICMP ping for the "O sd.bitech" userscript.
rem Keep this window open (minimize it). Autostart: sd-ping-helper.cmd -InstallAutostart
title sd.bitech ping helper
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sd-ping-helper.ps1" %*
if errorlevel 1 pause
