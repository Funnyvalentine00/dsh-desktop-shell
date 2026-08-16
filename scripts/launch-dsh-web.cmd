@echo off
rem Hidden worker for the DeepSeek Harness desktop shortcut:
rem runs `dsh web` (real profile) with output redirected so a hidden
rem console never loses error context. Launched by launch-dsh-web.ps1.
set "DSH_HOME=C:\Users\XHDN\.dsh"
"C:\Users\XHDN\AppData\Roaming\npm\dsh.cmd" web >> "C:\Users\XHDN\.dsh\desktop-shell-web.log" 2>&1
