# design-system

Design System primitives + token catalog。

Badge、Card、Icon、Button、Spinner、Textarea、Select、IconButton、Tooltip 的实现与样式位于 `src/render/design-system/`，本目录保留兼容导出。

## 目录结构

```
design-system/
├── primitives/
│   ├── Button.tsx              # 4 variant × 2 size × block
│   ├── Button.test.tsx         # 7 个测试
│   ├── Toast.tsx               # 4 kind × auto-dismiss
│   ├── Toast.test.tsx          # 4 个测试
│   ├── ContextRing.tsx         # SVG ring with N segments
│   ├── ContextRing.test.tsx    # 4 个测试
│   ├── KeyHint.tsx             # 跨平台快捷键标签
│   └── KeyHint.test.tsx        # 3 个测试
├── utils/
│   ├── buttonStyles.ts         # inline style 计算
│   ├── buttonStyles.test.ts    # 6 个测试
│   ├── ring.ts                 # SVG geometry + arc
│   ├── ring.test.ts            # 3 个测试
│   ├── keyHints.ts             # macOS/other 标签
│   ├── keyHints.test.ts        # 7 个测试
│   ├── toast.ts                # toast kind 颜色表
├── DesignSystemView.tsx        # catalog 页（路由 /design-system）
├── index.ts                    # barrel
└── README.md
```

## Primitives

| Primitive | 用途 | 源文件 |
|---|---|---|
| `Button` | 全局 button (primary/secondary/danger/ghost × sm/md) | `src/components/Button.tsx` |
| `Toast` | 单条 toast (4 kinds + auto-dismiss) | `src/components/Toast.tsx` |
| `ContextRing` | SVG ring 显示 context 用量 | `src/widgets/ContextRing.tsx` |
| `KeyHint` | 跨平台快捷键标签 | `src/widgets/KeyHint.tsx` |

## Utils

| Util | 纯函数 |
|---|---|
| `buttonStyle({variant, size, block})` | 计算 button inline style |
| `ringGeometry(size, stroke)` | SVG 几何 (cx, cy, radius, circumference) |
| `segmentArc(geom, start, length)` | 单 segment arc dasharray |
| `shortcutLabel(combo, platform)` | "Cmd+Enter" → "⌘↩" (macOS) |
| `platformLabel(platform)` | 全键位 label 表 |
| `detectPlatform()` | navigator.platform 检测 |
| `TOAST_COLORS` | 4 kind × {bg, fg, border} |

## Tokens

- 单一真相源：`src/render/styles/tokens.css`（CSS variables）
- 通过 `import '@/styles/tokens.css'` 注入（main.tsx）
- `detectPlatform` 选 macos vs other

## 测试覆盖

- utils 17 个（buttonStyles 6 + ring 3 + keyHints 7 + toast 颜色表）
- primitives 18 个（Button 7 + Toast 4 + ContextRing 4 + KeyHint 3）

合计 **35 个 design-system 测试**。

## 使用规约

- **样式**：所有 inline style 一律走 `utils/*Style.ts` 计算函数（避免到处散落 hex 字面量）
- **导出**：唯一对外 API 是 `index.ts` barrel；feature 内禁止 deep import `primitives/*`
- **新 primitive**：先写 utils 测试 → primitive 实现 → primitive 测试 → catalog 加入示例 → index 导出
- **跨平台**：快捷键一律过 `shortcutLabel`，禁止直接拼接字符串