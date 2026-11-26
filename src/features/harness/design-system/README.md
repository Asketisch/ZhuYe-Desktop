# design-system

Design System 原语的兼容入口 + token 目录页。

原语的实现与样式统一在 `src/render/design-system/`（CSS Modules + data-attribute 驱动，不用内联样式）；本目录只保留再出口、带状态的薄包装与就近测试，**没有第二套外观** —— 改原语外观一律改 `src/render/design-system/*.module.css`。

## 目录结构

```
design-system/
├── primitives/            # render 侧原语的再出口（多为一行 export *）
│   ├── Input.tsx          #   与 render 侧同内容的拷贝，共用 Input.module.css
│   ├── Toast.tsx          #   包装：加自动消失，再渲染 render 侧 Toast
│   └── *.test.tsx         #   Button / ContextRing / KeyHint / SegmentedControl / Toast / Tooltip
├── utils/                 # 对 src/logic/design-system/utils 的再出口 + 纯函数测试
├── DesignSystemView.tsx   # catalog 页（路由 /design-system）
├── index.ts               # barrel：切片取用原语的唯一入口
└── README.md
```

## Primitives（14 个）

| Primitive | 用途 | variant | 样式（`src/render/design-system/`） |
|---|---|---|---|
| `Button` | 全局 button | primary / secondary / tertiary / danger / ghost × sm / md / lg | `Button.module.css` |
| `IconButton` | 方形图标按钮 | default / active / primary / danger × sm / md / lg | `IconButton.module.css` |
| `Input` / `Select` / `Textarea` | 文本输入（带图标槽时外层 `.wrap` 承担描边） | sm / md | `Input.module.css` |
| `Badge` | 小标签 | neutral / accent / success / warning / danger / info，各带 `solid` | `Badge.module.css` |
| `Card` | 内容卡片 | flat / outlined / elevated × none / sm / md / lg 内边距 | `Card.module.css` |
| `Toast` | 单条 toast | info / success / warning / error | `Toast.module.css` |
| `Tooltip` | 悬停提示 | top / bottom / left / right，悬停 350ms 后出现 | `Tooltip.module.css` |
| `SegmentedControl` | 分段单选 | 默认 / `stacked` | `SegmentedControl.module.css` |
| `EmptyState` | 空状态 | sm / md / lg | `EmptyState.module.css` |
| `Spinner` / `Icon` | 加载指示 / 线性图标 | 按 `size` | `Spinner.module.css` / 无样式 |
| `KeyHint` / `ContextRing` | 快捷键标签 / SVG 分段环 | — | `primitives/*.module.css`（当前无消费方） |

没有 Popover 原语：锚点浮层用 `src/features/shell/AnchoredPopover`（只管定位与 portal），外观由调用方的样式给出。

## 外观口径

单一真相源是 `src/render/styles/tokens.css`（CSS variables），配色与材质刻度取自 `zhuye-agent-theme.html`（烛夜 · Amber / Graphite）：

- **圆角**：按钮与控件 6px（`--radius-sm`），卡片与浮层 8px（`--radius-md`），对话框 12px（`--radius-lg`）。
- **描边两档**：结构分隔 `--line`，可交互控件 `--line-2`。
- **主操作**：`--white` 实心 + `--shadow-sm` 顶部高光，悬停转琥珀；琥珀只给焦点 / 选中 / 进行中。
- **焦点**：`base.css` 的全局 `:focus-visible`（2px 琥珀 outline）；输入类控件另加 `--shadow-focus` 光环。
- **Badge**：细描边 4px 小圆角标签，不是胶囊。
- **浮层**：`--tip-bg` + `--line-2` 描边 + `--shadow-float`。

## 测试覆盖

- 原语：`primitives/*.test.tsx`（Button / ContextRing / KeyHint / SegmentedControl / Toast / Tooltip）。
- 纯函数：`utils/*.test.ts`（keyHints / ring）。

## 使用规约

- **导出**：切片内一律经 `index.ts` 桶文件取用，禁止 deep import `primitives/*`。
- **新 primitive**：在 `src/render/design-system/` 实现 → 补测试 → catalog 加入示例 → 本目录 `primitives/` 加再出口 → `index.ts` 导出。
- **跨平台**：快捷键一律过 `shortcutLabel`，禁止直接拼接字符串。
