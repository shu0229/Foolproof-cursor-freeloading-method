@echo off
echo ====== 端口清理工具 ======
echo 正在检查端口状态...

:: 设置要检查的端口
set PORT=3000

:: 检查端口状态
netstat -ano | findstr /R /C:"[:.]%PORT% .*LISTENING" > nul
if %errorlevel% equ 1 (
    echo 端口%PORT%当前未被占用
    goto check_next
)

:: 如果端口被占用，显示占用详情
echo.
echo 端口%PORT%当前被占用：
netstat -ano | findstr /R /C:"[:.]%PORT% .*LISTENING"
echo.

:: 尝试结束占用进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:"[:.]%PORT% .*LISTENING"') do (
    echo 正在结束PID: %%a
    taskkill /F /PID %%a
    if !errorlevel! equ 0 (
        echo 成功结束进程
    ) else (
        echo 结束进程失败
    )
)

:check_next
:: 检查3010端口
set PORT=3010
netstat -ano | findstr /R /C:"[:.]%PORT% .*LISTENING" > nul
if %errorlevel% equ 1 (
    echo 端口%PORT%当前未被占用
    goto end
)

echo.
echo 端口%PORT%当前被占用：
netstat -ano | findstr /R /C:"[:.]%PORT% .*LISTENING"
echo.

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:"[:.]%PORT% .*LISTENING"') do (
    echo 正在结束PID: %%a
    taskkill /F /PID %%a
    if !errorlevel! equ 0 (
        echo 成功结束进程
    ) else (
        echo 结束进程失败
    )
)

:end
echo.
echo ====== 端口清理完成 ======
pause 