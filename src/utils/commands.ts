/**
 * Reflect GUI 的前端 IPC 包装层。
 *
 * 包装器现按领域组织在 `./commands/{domain}.ts` 下。
 * 本文件作为向后兼容的再导出保留，使现有 `@/utils/commands`
 * 导入无需改动即可继续工作。
 *
 * **新代码请直接 import 自 `@/utils/commands` 或 `@/utils/commands/{domain}`。
 * `src/utils/tauri` 仍保留旧 barrel 作兼容入口。**
 *
 * 设计蓝图：`docs/protocol-bridge.md` §2 + §6。
 */
export * from './commands/index';
