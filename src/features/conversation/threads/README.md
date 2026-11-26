# threads

线程（threads）列表视图 + 链接生成工具。

## 目录结构

```
threads/
├── components/
│   ├── ThreadItem.tsx              # 单个 thread 行(router Link)
│   └── ThreadBucketGroup.tsx       # 时间桶 + 列表
├── utils/
│   ├── threadLabels.ts             # chatLinkFor + shortTimestamp
│   └── threadLabels.test.ts        # 4 个工具测试
├── ThreadsView.tsx                 # 顶层容器
├── ThreadsView.test.tsx            # 3 个视图测试
├── index.ts                        # 公共 barrel
└── README.md
```

## 入口

- **路由挂载**：`src/router.tsx` → `ThreadsView`
- **公共 API**：`import { ThreadsView } from '@/features/conversation/threads'`

## 依赖关系

- 复用 `features/conversation/sessions` 的 `useSessions` + `useActiveSession` + `SessionBucket`（**禁止**直接复制 buckets 规则）
- ThreadBucketGroup 只接受 SessionBucket 输入 → 单一真相源

## 测试覆盖

- `utils/threadLabels.test.ts` — 4 个测试（chatLink × 2、shortTimestamp × 2）
- `ThreadsView.test.tsx` — 3 个测试（render / empty / active highlight）
- `components/ThreadBucketGroup.test.tsx` — 4 个测试（render / active / click / multi）

合计 **11 个 thread slice 测试**。