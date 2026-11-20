@echo off
:: Batch script to map ugef.org to localhost in Windows hosts file
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

findstr /i "ugef.org" "%windir%\System32\drivers\etc\hosts" >nul
if %errorLevel% equ 0 (
    echo [OK] ugef.org is already mapped in your hosts file!
) else (
    echo.>> "%windir%\System32\drivers\etc\hosts"
    echo 127.0.0.1 ugef.org>> "%windir%\System32\drivers\etc\hosts"
    echo 127.0.0.1 www.ugef.org>> "%windir%\System32\drivers\etc\hosts"
    ipconfig /flushdns >nul
    echo [SUCCESS] ugef.org has been mapped to 127.0.0.1!
)

echo You can now open http://ugef.org in your browser.
timeout /t 5
