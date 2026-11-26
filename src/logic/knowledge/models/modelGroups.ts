/**
 * 模型组访问层 —— 模型选择链路（输入框选择器 / 模型页 / 跨组 failover）
 * 的**唯一**组数据入口。
 *
 * 规范实现在 `@/logic/settings/config/groups`（配置解析层，组 id 即接入
 * 目标）。本模块只做两件事：
 *  1. 把规范实现再导出 —— 调用方只从这一处 import，解析层改签名时
 *     改动面 = 1 个文件；
 *  2. 补上规范层暂未提供、但模型选择链路要用的两个助手：
 *     `readActiveCredential`（读 `[active].credential` 钉住的组内凭据）
 *     与 `pickFailoverGroup`（跨组 failover 目标挑选）。
 *
 * 契约要点：
 *  - 配置里只剩「模型组」一层：`[[model_group]]` 声明组，`[active].group`
 *    指向当前接入目标（**组 id 才是接入目标**，不再是 provider 名）；
 *  - 组内可挂多条凭据（`[[model_group.credentials]]`），`[active].credential`
 *    钉住其中一条 —— 「内置编码套餐」概念整层删除，套餐能力下沉到组内凭据；
 *  - 旧的 `[anthropic]` / `[openai]` / `[ollama]` 段与 `[[provider_group]]`
 *    由引擎读入时自动迁移成等价模型组（组 id = 段名），前端读入兼容、
 *    写入只出新格式。
 */

import {
  groupHasUsableCredential,
  listGroups,
  type GroupEntry,
} from '@/logic/harness/settings/config/groups';

export {
  GROUP_ENDPOINTS,
  groupDisplayLabel,
  groupHasUsableCredential,
  isValidGroupId,
  listGroups,
  readActiveGroup,
  setActiveGroup,
  type GroupCredentialEntry,
  type GroupEndpoint,
  type GroupEntry,
} from '@/logic/harness/settings/config/groups';

/**
 * 读取 `[active].credential` —— 组内被钉住的凭据 label（未钉住时为 ''）。
 *
 * 与后端 active_credential() 同规则：trim + 空串视为未钉住。
 * （规范解析层暂未暴露该键的读取器，先在此补齐。）
 */
export function readActiveCredential(toml: string): string {
  const lines = toml.split('\n');
  let inActive = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      // 任何表头（`[active]` / `[[model_group]]` …）都会结束 active 作用域。
      const header = /^\[([^\]]+)\]$/.exec(line);
      inActive = header?.[1].trim() === 'active';
      continue;
    }
    if (!inActive) continue;
    const kv = /^credential\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    return stripQuotes(kv[1].trim());
  }
  return '';
}

/**
 * 挑跨组 failover 目标：跳过刚耗尽的组，返回**下一个有可用凭据**的组；
 * 无候选 → null（调用方据此提示「没有备用模型组」）。
 */
export function pickFailoverGroup(toml: string, failedGroupId: string): GroupEntry | null {
  for (const group of listGroups(toml)) {
    if (group.id === failedGroupId) continue;
    if (groupHasUsableCredential(group)) return group;
  }
  return null;
}

/** 取 TOML 字符串字面量的内容（单双引号都认）。 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
