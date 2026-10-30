# docs/assets/

> 公开 README / docs 网站引用的图片资源（轻量，每个 ≤ 1MB）。

## 截图清单

| 文件 | 主题 | 取图步骤 |
|---|---|---|
| `main.png` | 主界面（侧栏 + chat + composer） | macOS dev: `pnpm tauri dev` → Cmd+1 选 home → Cmd+Shift+4 |
| `feature1.png` | Composer + Slash Popup | 输入 `/` 触发 popup，截图 |
| `feature2.png` | Session sidebar（时间分桶 Now/Today/...） | 跑多个 session 后截图 |
| `feature3.png` | Approval Modal | 触发工具审批后截图 |
| `feature4.png` | Settings → Display/Editor/Provider | 打开 Settings 视图 |
| `feature5.png` | Plan mode + Plan ready modal | `/plan` 进入 plan mode |
| `feature6.png` | 右 panel：tool inspector + cost ring | M2.2/2.3 实施后 |
| `app-icon.png` | 应用图标（1024×1024 PNG） | `src-tauri/icons/` 任意一张导出 |

## 取图规范

- **分辨率**：2x（Retina），单张 ≤ 1MB（GitHub README 显示最佳）
- **主题**：dark（默认），如有 light 变体命名 `*-light.png`
- **窗口尺寸**：1280×800（与 `tauri.conf.json` 默认一致）
- **命名**：`{scope}-{feature}-{date}.png`，例：`home-dashboard-usage-20260313.png`

## 临时占位策略

为避免文档空白，docs 网站 (`docs/index.html`) 在图片缺失时 fallback 到：

```html
<img src="./assets/main.png" alt="烛夜 ZhuYe"
     onerror="this.src='./assets/placeholder.svg'" />
```

`placeholder.svg` 为内联 SVG 卡片（深色 + 标题 + 副标题），见 `docs/index.html`。