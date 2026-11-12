// macOS 原生窗口探针:只依赖 CoreGraphics 窗口层,不要求辅助功能权限。
import CoreGraphics
import Foundation

let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] ?? []

let matches = windows.filter { info in
    let owner = info[kCGWindowOwnerName as String] as? String ?? ""
    return owner.localizedCaseInsensitiveContains("reflect-desktop")
        || owner.localizedCaseInsensitiveContains("ZhuYe")
}

for window in matches {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let pid = window[kCGWindowOwnerPID as String] as? Int32 ?? -1
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Double ?? 0
    let height = bounds["Height"] as? Double ?? 0
    print("owner=\(owner) pid=\(pid) width=\(Int(width)) height=\(Int(height))")
}

let hasMainWindow = matches.contains { window in
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Double ?? 0
    let height = bounds["Height"] as? Double ?? 0
    return width >= 800 && height >= 600
}

if matches.isEmpty || !hasMainWindow {
    fputs("未找到 ZhuYe / reflect-desktop 不小于 800×600 的在屏主窗口\n", stderr)
    exit(1)
}
