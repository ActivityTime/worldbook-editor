@echo off
rem wbedit.cmd — Windows 启动器：在任意目录可直接调用 wbedit
setlocal
node "%~dp0wbedit.js" %*
endlocal
