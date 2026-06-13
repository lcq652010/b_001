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

echo [1/3] 添加 wasm32-unknown-unknown 目标...
rustup target add wasm32-unknown-unknown --toolchain stable

echo.
echo [2/3] 检查 wasm-pack...
where wasm-pack >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 未找到 wasm-pack，正在安装...
    cargo install wasm-pack
)

echo.
echo [3/3] 编译 WebAssembly 模块...
wasm-pack build --target web --out-dir ..\client\public\wasm --release

if %ERRORLEVEL% neq 0 (
    echo.
    echo [警告] WASM 编译失败，前端将使用 JS 降级模式
    echo 如需修复，请确保 Rust 工具链和 wasm-pack 正确安装
)

echo.
echo === 构建完成！输出目录: ..\client\public\wasm\ ===
pause
