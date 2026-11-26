/**
 * 旧版 `./configSchema` 导入路径的兼容性再导出。
 *
 * 结构化配置模式已拆分到：
 *   - `./config/schema.ts`  — 纯类型 + TOML 标量字段辅助函数
 *   - `./config/toml.ts`    — 纯 TOML 分区 / flag 辅助函数
 *   - `./components/StructuredField.tsx` — React 字段渲染器
 *
 * 现有调用方（`import { ... } from '@/features/harness/settings/configSchema'`）
 * 无需改动即可继续工作。
 */

export {
  COMPLEX_SECTIONS,
  SIMPLE_FIELDS_BY_SECTION,
  STRUCTURED_SECTIONS,
  applyField,
  readField,
  type FieldKind,
  type FieldSpec,
} from '@/logic/settings/config/schema';
export { StructuredField, type StructuredFieldProps } from './components/StructuredField';