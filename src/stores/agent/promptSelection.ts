/**
 * 会话级提示词预设偏好 —— per-session localStorage（仿 approvalPolicy.ts）。
 *
 * 入口只在最初创建会话时存在（「+」菜单的提示词预设子菜单，空会话态
 * 显示），会话开始后 UI 不再提供变更 —— 引擎 CacheBreakDetector 以
 * system+tools+model 指纹观测缓存,同一会话内提示词恒定即缓存命中不受损。
 *
 * 存储的值是引擎 `PromptSelection` wire 形状(`{mode:'default'}|{mode:'auto'}|
 * {mode:'manual',profile}`)。bind 会话时经 `syncSessionPromptSelection`
 * 恢复该会话自己的选择(提交 `Op::PromptCommand::Select`,rollout 记录
 * `PromptSelectionChanged`,resume 语义原生支持);未选择过的会话恢复跟随
 * 全局默认(`selection: null`)。
 */
import { zhuye_prompt_command, type PromptSelection } from '@/utils/commands/prompts';
import { useAgentStore } from './store';

const KEY = 'zhuye.promptSelection.';
const memory = new Map<string, PromptSelection>();

/** 无记录时返回 null = 跟随全局默认(引擎 `prompt_selection.unwrap_or(prompt_default)`)。 */
export function readPromptSelection(sessionId: string | null | undefined): PromptSelection | null {
  try {
    const value = localStorage.getItem(KEY + (sessionId ?? 'new'));
    return value ? (JSON.parse(value) as PromptSelection) : null;
  } catch {
    return memory.get(sessionId ?? 'new') ?? null;
  }
}

export function writePromptSelection(sessionId: string | null | undefined, value: PromptSelection): void {
  const key = sessionId ?? 'new';
  memory.set(key, value);
  try { localStorage.setItem(KEY + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** 会话 id 落定后把预创建键(`'new'`)的选择转正到正式会话键。
 *  首页 composer 写入的是 `'new'` 键;ensureSessionReady 创建成功后转正,
 *  让「创建前选好」随首条消息生效(也是 bind 恢复能读到的键)。 */
export function movePromptSelection(from: string, to: string): void {
  const value = readPromptSelection(from);
  if (!value) return;
  writePromptSelection(to, value);
  memory.delete(from);
  try { localStorage.removeItem(KEY + from); } catch { /* storage unavailable */ }
}

/**
 * bind 会话后恢复该会话的提示词选择(引擎共享锁,下一次 model_call 生效)。
 *
 * 三分支:
 * - 有会话记录 → 提交 Select(记录) —— 该会话从创建起提示词恒定;
 * - 无记录但进程锁当前**不**是跟随默认(上个会话留下的) → 提交
 *   Select(null) 恢复跟随全局默认,避免会话间串味;
 * - 无记录且锁已是跟随默认 → 跳过,不写冗余 rollout 记录。
 *
 * fire-and-forget:Select 不开 turn,应答经 `prompt_switched` 事件回流。
 */
export function syncSessionPromptSelection(sessionId: string | null | undefined): void {
  const saved = readPromptSelection(sessionId);
  if (saved) {
    void zhuye_prompt_command({ type: 'select', selection: saved }).catch(() => {
      /* 选择失败不阻断会话 —— 下次 bind 会再试;错误经事件通道无回显需求 */
    });
    return;
  }
  const current = useAgentStore.getState().prompt?.selection ?? null;
  if (current !== null) {
    void zhuye_prompt_command({ type: 'select', selection: null }).catch(() => { /* 同上 */ });
  }
}
