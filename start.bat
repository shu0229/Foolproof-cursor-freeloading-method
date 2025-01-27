@echo off
setlocal enabledelayedexpansion
echo ====== 启动程序 ======
pip install -r requirements.txt
call npm install
call npm run start
start http://localhost:3000

pause
endlocal