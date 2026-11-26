# sessions

会话侧栏（time-bucketed sidebar）+ 时间分桶工具 + 命名 session。会话数据 hook、时间桶和工作区分组实现在 `src/logic/sessions/`，本切片路径提供兼容导出。

## 目录结构

```
sessions/
├── components/
│   ├── Sidebar.tsx           # 容器侧栏
│   ├── Sidebar.test.tsx      # 6 个组件测试
│   ├── SessionItem.tsx       # 单个 session 行 (memo) + 运行态徽标
│   ├── SessionItem.test.tsx  # 5 个运行态徽标测试
│   └── BucketGroup.tsx       # 单个时间桶
├── hooks/
│   ├── useSessions.ts        # 逻辑目录 hook 的兼容导出
│   └── useSessions.test.tsx  # 5 个 hook 测试 + 1 个 useActiveSession
├── utils/
│   ├── buckets.ts            # 逻辑目录分桶的兼容导出
│   └── buckets.test.ts       # 11 个纯函数测试
├── SessionsView.tsx          # 顶层容器(组合 hook + Sidebar)
├── index.ts                  # 公共 barrel
└── README.md
```

## 入口

- **侧栏主入口**：`src/features/shell/AppShell.tsx` 渲染 `<Sidebar>`（AppShell 是 IDE shell 的 root）
- **路由入口**：`/sessions` 路由用 `ThreadsView`（独立全屏列表视图）
- **侧栏复用**：AppShell 直接传 props 用 Sidebar 组件
- **数据获取**：`useSessions()` 返回 `{ buckets, all, loading, error, refetch, refresh, rename }`
- **当前活动**：`useActiveSession()` 返回 `{ activeId, setActiveId }`

> 注：`SessionsView` 是 Sidebar 的薄包装（保留为 barrel 导出契约），未被任何路由直接挂载。

## 关键决策

1. **bucket 规则抽到 utils**：`bucketFor` / `bucketSessions` / `displayTitle` 是纯函数，跨测试/跨 feature 复用方便（详见 [`utils/buckets.test.ts`](utils/buckets.test.ts)）。
2. **activeId 独立 hook**：`useActiveSession` 不与 useSessions 耦合，便于多视图共享。
3. **SessionItem memo**：避免列表 re-render。
4. **运行态徽标活动/后台同款**：`SessionItem` 同时订阅主 store（活动会话的运行态与待确认交互）与后台注册表（非活动会话的投影），统一渲染呼吸点（`session-running-<id>`）与待确认徽标（`session-pending-<id>`）。改徽标语义时两处投影都要看。
5. **Barrel export**：`index.ts` 是唯一对外 API；router/其他 feature 只从这里 import。

## 测试覆盖

- `utils/buckets.test.ts` — 11 个测试（5 个 bucketFor + 3 个 bucketSessions + 1 个 displayTitle + 2 个边界）
- `hooks/useSessions.test.tsx` — 6 个测试（mount、buckets、rename、error、refresh、activeId）
- `components/Sidebar.test.tsx` — 6 个测试（empty/loading/error/render/select/refresh）
- `components/SessionItem.test.tsx` — 5 个测试（活动行运行点 / 活动行无运行态 / 后台运行点 / 活动行待审批 / 后台待确认）

合计 **28 个 session slice 测试**。