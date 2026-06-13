@echo off
chcp 65001 >nul
title Pixel Frame - 全栈视频像素风应用

echo ========================================
echo  Pixel Frame - 启动脚本
echo ========================================
echo.

echo [1/3] 安装后端依赖...
if not exist "server\node_modules" (
    cd server
    call npm install
    cd ..
)

echo.
echo [2/3] 安装前端依赖...
if not exist "client\node_modules" (
    cd client
    call npm install
    cd ..
)

echo.
echo [3/3] 启动服务...
echo.
echo 请在两个独立的终端中执行以下命令:
echo.
echo   终端 1 (后端):  cd server ^&^& npm start
echo   终端 2 (前端):  cd client ^&^& npm run dev
echo.
echo   如需构建 Rust WASM:  cd wasm-filter ^&^& build.bat
echo.
echo   注意: 如未安装 ffmpeg，前端将自动使用 HTML5 Video 帧提取降级模式
echo.
pause
