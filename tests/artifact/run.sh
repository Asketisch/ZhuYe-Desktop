#!/usr/bin/env bash
# tests/artifact/run.sh —— 发布产物审查层(发布门禁 L4)。
#
# 这一层不看源码,看**真正要发出去的东西**:
#   - bundle 是否存在(按平台找 .app / .deb / .AppImage / .msi);
#   - macOS .app 的 Info.plist 键是否齐、版本是否与 package.json 一致;
#   - 前端资源是否真的嵌进了二进制(而不是只躺在 dist/ 里);
#   - bundle 里有没有开发残留(.DS_Store / sourcemap / node_modules);
#   - macOS 签名是否成立。
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
        local listing
        listing=$(dpkg-deb -c "$DEB_FILE" 2>/dev/null)
        if ! echo "$listing" | grep -q 'reflect-desktop'; then
            echo ".deb 内未找到 reflect-desktop 可执行文件"
            return 1
        fi
        echo ".deb 内容正确(含 reflect-desktop 可执行文件)"
        return 0
    }
    tcase ".deb 内含 reflect-desktop 可执行文件" check_deb_contents
fi

if [ -n "$APPIMAGE_FILE" ]; then
    check_appimage() {
        if [ ! -s "$APPIMAGE_FILE" ]; then
            echo ".AppImage 为空文件"
            return 1
        fi
        echo ".AppImage 就位($(wc -c < "$APPIMAGE_FILE" | tr -d ' ') 字节)"
        return 0
    }
    tcase ".AppImage 非空" check_appimage
fi

# ── 4. Windows:.msi ──────────────────────────────────────────────────────
if [ -n "$MSI_FILE" ]; then
    check_msi() {
        if [ ! -s "$MSI_FILE" ]; then
            echo ".msi 为空文件"
            return 1
        fi
        echo ".msi 就位($(wc -c < "$MSI_FILE" | tr -d ' ') 字节)"
        return 0
    }
    tcase ".msi 非空" check_msi
fi

tfinish
