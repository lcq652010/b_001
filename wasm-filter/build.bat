@echo off
chcp 65001 >nul
echo === 构建 Rust WebAssembly 像素滤镜模块 ===
echo.

cd /d "%~dp0"

where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Rust 工具链 ^(cargo^)
    echo 请访问 https://rustup.rs 安装 Rust
    pause
    exit /b 1
)

echo [1/2] 检查 wasm32 目标...
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-gnu

echo.
echo [2/2] 编译 WebAssembly 模块...
cargo build --target wasm32-unknown-unknown --release

if %ERRORLEVEL% neq 0 (
    echo [错误] WASM 编译失败
    pause
    exit /b 1
)

echo.
echo 复制到前端 public/wasm 目录...
if not exist "..\client\public\wasm" mkdir "..\client\public\wasm"
copy /y "target\wasm32-unknown-unknown\release\pixel_filter.wasm" "..\client\public\wasm\pixel_filter.wasm"

echo.
echo === 构建完成！===
echo   输出: ..\client\public\wasm\pixel_filter.wasm
echo   Rust 导出: malloc, free, pixelate
echo   JS 接口: initFilter, applyPixelFilter, destroyFilter
echo.
pause
