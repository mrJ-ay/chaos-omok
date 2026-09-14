@echo off
chcp 65001 > nul
cls

echo ==========================================
echo        카오스 슈퍼오목 자동 푸시 시작
echo ==========================================
echo.

git add -A
set /p msg="커밋 메시지 입력 (엔터 치면 자동생성): "
if "%msg%"=="" ( set msg=update: %date% %time% )

git commit -m "%msg%"
git push origin main

echo.
if %errorlevel% equ 0 (
    echo ==========================================
    echo [성공] 깃허브 업로드 완료! Render 배포 시작됨.
    echo ==========================================
) else (
    echo [실패] 푸시 중 문제가 발생했습니다.
)
echo.
pause