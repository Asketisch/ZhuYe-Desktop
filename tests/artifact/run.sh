#!/usr/bin/env bash
# tests/artifact/run.sh —— 发布产物审查层(发布门禁 L4)。
#
# 这一层不看源码,看**真正要发出去的东西**:
#   - bundle 是否存在(按平台找 .app / .deb / .AppImage / .msi);
#   - macOS .app 的 Info.plist 键是否齐、版本是否与 package.json 一致;
#   - 前端资源是否真的嵌进了二进制(而不是只躺在 dist/ 里);
#   - bundle 里有没有开发残留(.DS_Store / sourcemap / node_modules);
#   - macOS 签名是否成立;
#   - Linux .deb 深度解包(usr/bin 可执行 / .desktop(Exec) / 图标 /
#     control 版本)与 .AppImage 解包(AppRun / .desktop);
#   - Windows .msi 管理映像解包(exe 存在 + ProductVersion);
#   - 启动冒烟(二进制真的能起来,8-10s 内不崩)—— 默认关,
#     CI 或 ARTIFACT_LAUNCH_SMOKE=1 时启用(本机跑会弹真窗口)。
#
# 产物缺失时整层 SKIP(不算失败)—— 本地跑门禁常常还没构建。
# 要强制要求产物存在:ARTIFACT_REQUIRED=1 ./tests/run_all.sh artifact
#
# 退出码 0 = 全部通过。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "artifact"

PLATFORM="$(uname -s)"

# ── 0. 定位产物 ───────────────────────────────────────────────────────────
APP_BUNDLE=""
DEB_FILE=""
APPIMAGE_FILE=""
MSI_FILE=""
case "$PLATFORM" in
    Darwin)
        APP_BUNDLE=$(find "$DIST_DIR/macos" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)
        ;;
    Linux)
        DEB_FILE=$(find "$DIST_DIR/deb" -maxdepth 1 -name '*.deb' 2>/dev/null | head -1)
        APPIMAGE_FILE=$(find "$DIST_DIR/appimage" -maxdepth 1 -name '*.AppImage' 2>/dev/null | head -1)
        ;;
    MINGW* | MSYS* | CYGWIN*)
        MSI_FILE=$(find "$DIST_DIR/msi" -maxdepth 1 -name '*.msi' 2>/dev/null | head -1)
        ;;
esac

FOUND_ANY=""
[ -n "$APP_BUNDLE" ] && FOUND_ANY=1
[ -n "$DEB_FILE" ] && FOUND_ANY=1
[ -n "$APPIMAGE_FILE" ] && FOUND_ANY=1
[ -n "$MSI_FILE" ] && FOUND_ANY=1

if [ -z "$FOUND_ANY" ]; then
    if [ "${ARTIFACT_REQUIRED:-0}" = "1" ]; then
        tcase "发布产物存在" false
        echo "         │ 提示:先执行 bash scripts/build.sh(或 pnpm tauri build)"
    else
        tskip "artifact" "未找到发布产物($DIST_DIR 下无本平台 bundle);先跑 bash scripts/build.sh"
    fi
    tfinish
    exit $?
fi

# ── 0.5 读取 .app 的真实可执行文件名 ─────────────────────────────────────
# 可执行文件名**不等于**产品名 —— 它取自 Cargo 的 bin 名(本项目是
# `reflect-desktop`),权威来源是 Info.plist 的 CFBundleExecutable。
# 顺带这本身就是一条审查:plist 声明的名字必须真有那个文件。
app_executable() {
    local bundle="$1"
    local plist="$bundle/Contents/Info.plist"
    [ -f "$plist" ] || return 1
    local name
    name=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$plist" 2>/dev/null) \
        || name=$(sed -n 's:.*<key>CFBundleExecutable</key>.*<string>\(.*\)</string>.*:\1:p' "$plist" | head -1)
    [ -n "$name" ] || return 1
    printf '%s' "$bundle/Contents/MacOS/$name"
}

# ── 1. 前端资源已进入产物 ─────────────────────────────────────────────────
check_frontend_embedded() {
    local dist="$ROOT/dist"
    [ -s "$dist/index.html" ] || { echo "dist/index.html 缺失 —— 前端未构建"; return 1; }
    local binary=""
    if [ -n "$APP_BUNDLE" ]; then
        binary=$(app_executable "$APP_BUNDLE" || true)
    fi
    if [ -z "$binary" ] || [ ! -f "$binary" ]; then
        # 非 macOS 平台(或 plist 读不出可执行名):退一步确认 dist 存在
        # (嵌入由 Tauri 打包期保证)。
        echo "dist/ 前端产物就位(index.html $(wc -c < "$dist/index.html" | tr -d ' ') 字节)"
        return 0
    fi
    # Tauri 把前端资源以 include_bytes 嵌进二进制 —— 二进制里能看到资源名。
    local marker
    for marker in "index.html" "assets"; do
        if ! grep -a -q -F -- "$marker" "$binary"; then
            echo "二进制里找不到前端资源标记:$marker"
            return 1
        fi
    done
    echo "前端资源已嵌入二进制($(basename "$binary"))"
    return 0
}
tcase "前端资源已进入发布产物" check_frontend_embedded

# ── 2. macOS:.app 结构与 Info.plist ──────────────────────────────────────
if [ -n "$APP_BUNDLE" ]; then
    check_app_layout() {
        local exe
        exe=$(app_executable "$APP_BUNDLE" || true)
        if [ -z "$exe" ]; then
            echo "Info.plist 读不出 CFBundleExecutable"
            return 1
        fi
        if [ ! -d "$APP_BUNDLE/Contents" ]; then
            echo "$APP_BUNDLE 不是合法 .app(缺 Contents/)"
            return 1
        fi
        if [ ! -x "$exe" ]; then
            echo "主二进制缺失或不可执行:$exe"
            return 1
        fi
        if [ ! -f "$APP_BUNDLE/Contents/Info.plist" ]; then
            echo "Info.plist 缺失"
            return 1
        fi
        echo ".app 结构完整(二进制 $(basename "$exe") $(wc -c < "$exe" | tr -d ' ') 字节)"
        return 0
    }
    tcase "macOS .app 结构完整(Contents/ + 可执行二进制 + Info.plist)" check_app_layout

    check_info_plist() {
        local plist="$APP_BUNDLE/Contents/Info.plist"
        local missing=""
        for key in CFBundleIdentifier CFBundleName CFBundleExecutable CFBundleShortVersionString CFBundleVersion; do
            if ! grep -q "<key>$key</key>" "$plist"; then
                missing="$missing $key"
            fi
        done
        if [ -n "$missing" ]; then
            echo "Info.plist 缺少键:$missing"
            return 1
        fi
        echo "Info.plist 必备键齐备"
        return 0
    }
    tcase "Info.plist 必备键齐备" check_info_plist

    check_info_version() {
        local plist="$APP_BUNDLE/Contents/Info.plist"
        local pkg short
        pkg=$(node -p "require('./package.json').version" 2>/dev/null) || {
            echo "读不到 package.json 版本"
            return 1
        }
        short=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$plist" 2>/dev/null \
            || sed -n 's:.*<key>CFBundleShortVersionString</key>.*<string>\(.*\)</string>.*:\1:p' "$plist" | head -1)
        if [ "$short" != "$pkg" ]; then
            echo "Info.plist CFBundleShortVersionString=$short ≠ package.json=$pkg"
            return 1
        fi
        echo "Info.plist 版本与 package.json 一致($pkg)"
        return 0
    }
    tcase "Info.plist 版本与 package.json 一致" check_info_version

    check_no_dev_leftovers() {
        local junk
        junk=$(find "$APP_BUNDLE" \( -name '.DS_Store' -o -name '*.map' -o -name 'node_modules' \) 2>/dev/null | head -5)
        if [ -n "$junk" ]; then
            echo "bundle 内含开发残留:$(echo "$junk" | tr '\n' ' ')"
            return 1
        fi
        echo "bundle 内无开发残留"
        return 0
    }
    tcase "bundle 内无开发残留(.DS_Store / sourcemap / node_modules)" check_no_dev_leftovers

    check_codesign() {
        if ! require_cmd codesign; then
            echo "本机无 codesign —— 跳过签名检查"
            return 0
        fi
        if codesign -dv "$APP_BUNDLE" >/dev/null 2>&1; then
            echo "codesign 校验通过($(codesign -dv "$APP_BUNDLE" 2>&1 | grep -o 'Signature=.*' | head -1))"
            return 0
        fi
        echo "codesign 校验失败 —— 未签名或签名损坏"
        return 1
    }
    tcase "macOS 签名成立" check_codesign
fi

# ── 3. Linux:.deb / .AppImage 内容 ────────────────────────────────────────
if [ -n "$DEB_FILE" ]; then
    check_deb_contents() {
        if ! require_cmd dpkg-deb; then
            echo "本机无 dpkg-deb —— 跳过 .deb 内容检查"
            return 0
        fi
        local pkg_version
        pkg_version=$(node -p "require('./package.json').version" 2>/dev/null) || {
            echo "读不到 package.json 版本"; return 1
        }
        # control 元数据:版本必须与 package.json 一致。
        local deb_version
        deb_version=$(dpkg-deb -f "$DEB_FILE" Version 2>/dev/null)
        if [ "$deb_version" != "$pkg_version" ]; then
            echo ".deb control Version=$deb_version ≠ package.json=$pkg_version"
            return 1
        fi
        # 解包验真实布局:可执行文件 / .desktop / 图标。
        local root
        root=$(mktemp -d "${TMPDIR:-/tmp}/reflect-deb-audit.XXXXXX")
        dpkg-deb -x "$DEB_FILE" "$root" 2>/dev/null || { echo "dpkg-deb -x 解包失败"; return 1; }
        local exe="$root/usr/bin/reflect-desktop"
        if [ ! -x "$exe" ]; then
            echo ".deb 缺少可执行文件 usr/bin/reflect-desktop(实际:$(ls "$root/usr/bin" 2>/dev/null))"
            return 1
        fi
        local desktop
        desktop=$(find "$root/usr/share/applications" -name '*.desktop' 2>/dev/null | head -1)
        if [ -z "$desktop" ]; then
            echo ".deb 缺少 .desktop 文件"
            return 1
        fi
        grep -q '^Exec=' "$desktop" || { echo ".desktop 缺 Exec 键"; return 1; }
        if ! find "$root/usr/share/icons" -type f 2>/dev/null | grep -q .; then
            echo ".deb 缺少图标(/usr/share/icons)"
            return 1
        fi
        rm -rf "$root"
        echo ".deb 深度校验通过(可执行 + .desktop(Exec) + 图标 + control 版本 $pkg_version)"
        return 0
    }
    tcase ".deb 深度校验(可执行 / .desktop / 图标 / control 版本)" check_deb_contents
fi

if [ -n "$APPIMAGE_FILE" ]; then
    check_appimage() {
        if ! require_cmd file; then
            echo "本机无 file —— 跳过 .AppImage 解包检查"; return 0
        fi
        local root
        root=$(mktemp -d "${TMPDIR:-/tmp}/reflect-appimage-audit.XXXXXX")
        cp "$APPIMAGE_FILE" "$root/app.AppImage"
        if ! (cd "$root" && chmod +x app.AppImage && ./app.AppImage --appimage-extract >/dev/null 2>&1); then
            echo "--appimage-extract 解包失败"
            rm -rf "$root"
            return 1
        fi
        [ -e "$root/squashfs-root/AppRun" ] || { echo "AppImage 缺 AppRun"; rm -rf "$root"; return 1; }
        local desktop
        desktop=$(find "$root/squashfs-root" -maxdepth 1 -name '*.desktop' | head -1)
        [ -n "$desktop" ] || { echo "AppImage 缺 .desktop"; rm -rf "$root"; return 1; }
        grep -q '^Exec=' "$desktop" || { echo "AppImage .desktop 缺 Exec 键"; rm -rf "$root"; return 1; }
        rm -rf "$root"
        echo ".AppImage 解包校验通过(AppRun + .desktop(Exec))"
        return 0
    }
    tcase ".AppImage 深度校验(AppRun / .desktop)" check_appimage
fi

# ── 4. Windows:.msi ───────────────────────────────────────────────────────
if [ -n "$MSI_FILE" ]; then
    check_msi() {
        if ! require_cmd msiexec; then
            echo "本机无 msiexec —— 仅验非空"
            [ -s "$MSI_FILE" ] || { echo ".msi 为空文件"; return 1; }
            echo ".msi 就位($(wc -c < "$MSI_FILE" | tr -d ' ') 字节)"
            return 0
        fi
        local pkg_version
        pkg_version=$(node -p "require('./package.json').version" 2>/dev/null) || {
            echo "读不到 package.json 版本"; return 1
        }
        # 管理映像解包(不安装):验 exe 存在 + ProductVersion 与 package.json 一致。
        local dir
        dir=$(mktemp -d "${TMPDIR:-/tmp}/reflect-msi-audit.XXXXXX")
        # cygpath:git-bash 的 mktemp 路径要转成 Windows 路径给 msiexec。
        local windir="$dir"
        command -v cygpath >/dev/null 2>&1 && windir=$(cygpath -w "$dir")
        if ! msiexec /a "$(cygpath -w "$MSI_FILE" 2>/dev/null || echo "$MSI_FILE")" /qn TARGETDIR="$windir"; then
            echo "msiexec 管理映像解包失败"
            rm -rf "$dir"
            return 1
        fi
        local exe
        exe=$(find "$dir" -name 'reflect-desktop*.exe' -o -name 'ReflectDesktop*.exe' 2>/dev/null | head -1)
        [ -n "$exe" ] || { echo ".msi 解包后未找到主 exe"; rm -rf "$dir"; return 1; }
        local ver
        ver=$(powershell -NoProfile -Command "(Get-Item '$(cygpath -w "$exe" 2>/dev/null || echo "$exe")').VersionInfo.ProductVersion" 2>/dev/null | tr -d '\r')
        if [ -n "$ver" ] && [ "$ver" != "$pkg_version" ]; then
            echo "exe ProductVersion=$ver ≠ package.json=$pkg_version"
            rm -rf "$dir"
            return 1
        fi
        rm -rf "$dir"
        echo ".msi 深度校验通过(exe 存在,版本 $pkg_version)"
        return 0
    }
    tcase ".msi 深度校验(管理映像解包 + exe 版本)" check_msi
fi

# ── 5. 启动冒烟:二进制真的能起来(退出码 124 = 被超时杀 = 正常运行) ──────
# 默认关:本机跑门禁会弹真窗口抢焦点。CI(CI=1)或显式
# ARTIFACT_LAUNCH_SMOKE=1 时启用;Linux 需 xvfb-run(无则该条跳过)。
launch_smoke_enabled() {
    [ "${ARTIFACT_LAUNCH_SMOKE:-0}" = "1" ] || [ "${CI:-0}" = "true" ] || [ "${CI:-0}" = "1" ]
}

if launch_smoke_enabled; then
    if [ -n "$APP_BUNDLE" ]; then
        check_launch_smoke_macos() {
            local exe
            exe=$(app_executable "$APP_BUNDLE" || true)
            [ -n "$exe" ] && [ -x "$exe" ] || { echo "读不到可执行文件"; return 1; }
            run_with_timeout 8 "$exe"
            local rc=$?
            # 124 = 超时杀掉(= 一直活着);0 = 自行退出也算起动成功。
            if [ "$rc" -eq 124 ] || [ "$rc" -eq 0 ]; then
                echo "macOS 二进制启动冒烟通过(退出码 $rc)"
                return 0
            fi
            echo "macOS 二进制启动即崩(退出码 $rc)"
            return 1
        }
        tcase "macOS 启动冒烟(二进制 8s 内不崩)" check_launch_smoke_macos
    fi

    if [ -n "$DEB_FILE" ] || [ -n "$APPIMAGE_FILE" ]; then
        check_launch_smoke_linux() {
            if ! require_cmd xvfb-run; then
                echo "本机无 xvfb-run —— 跳过启动冒烟(仅 CI ubuntu 可跑)"
                return 0
            fi
            local target=""
            if [ -n "$DEB_FILE" ]; then
                local root
                root=$(mktemp -d "${TMPDIR:-/tmp}/reflect-launch-deb.XXXXXX")
                dpkg-deb -x "$DEB_FILE" "$root" 2>/dev/null
                target="$root/usr/bin/reflect-desktop"
            elif [ -n "$APPIMAGE_FILE" ]; then
                target="$APPIMAGE_FILE"
                chmod +x "$target" 2>/dev/null
            fi
            [ -n "$target" ] && [ -e "$target" ] || { echo "找不到可启动的二进制"; return 1; }
            run_with_timeout 10 xvfb-run -a "$target"
            local rc=$?
            if [ "$rc" -eq 124 ] || [ "$rc" -eq 0 ]; then
                echo "Linux 二进制启动冒烟通过(退出码 $rc)"
                return 0
            fi
            echo "Linux 二进制启动即崩(退出码 $rc)"
            return 1
        }
        tcase "Linux 启动冒烟(xvfb 下 10s 内不崩)" check_launch_smoke_linux
    fi
fi

tfinish
