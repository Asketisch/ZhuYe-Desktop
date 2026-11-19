/**
 * Slash engine —— 解析 + 分发 `/command args...` 输入。
 *
 * 契约：
 *   - `parseSlash(input)` 把文本切成 `{ command, args, raw, isSlash }`。
 *     `isSlash = false` 表示非 slash（普通提交）,由 caller 走 user_input_text。
 *   - `executeSlash(parsed, ctx)` 执行命令,返回 `SlashResult`:
 *       `{ kind: 'submit' | 'submit_with_submission' | 'no-op' | 'reject', payload, message }`
 *     其中 `submit_with_submission` 表示 caller 应该用 raw submission 而不是 freeform text
 *     (例如 `/compact` → 触发 compact,而不是把 "/compact" 当文本)。
 *   - 命令 → action 是纯映射;不副作用(纯函数),方便测试。
 *
 * B4 涵盖 46 个命令的核心语义。Tier A 9 个有"实装"的执行,其余标记为
 * 'no-op' 但仍然 parse + dispatch(避免 silent failure)。
 */
import { SLASH_COMMANDS, type SlashCmd, isPluginCommand } from './slashCommands';

export interface ParsedSlash {
  command: string;
  args: string[];
  raw: string;
  isSlash: true;
}

export interface PlainText {
  raw: string;
  isSlash: false;
}

export type SlashInput = ParsedSlash | PlainText;

export type SlashResultKind =
  | 'submit' // 普通文本提交，freeform
  | 'submit_with_submission' // 触发了特定 Submission（compact/interrupt/...）
  | 'no-op' // 解析成功但尚未实装，告诉 UI "command handled"
  | 'reject'; // 非法输入

export interface SlashResult {
  kind: SlashResultKind;
  /** 可选的 Submission kind（与 `reflect_*` 命令对应）。 */
  submission?: string;
  /** `kind === 'submit'` 时的纯文本 payload。 */
  payload?: string;
  /** 面向用户的信息（状态、错误等）。 */
  message?: string;
}

export interface SlashContext {
  activeSessionId: string | null;
  now: () => Date;
}

/** 从自由文本中解析 `/cmd args...`。 */
export function parseSlash(input: string): SlashInput {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { raw: trimmed, isSlash: false };
  // 匹配 `/<cmd>` 后跟零个或多个空格分隔的参数。
  const m = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!m) return { raw: trimmed, isSlash: false };
  const command = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();
  const args = rest ? rest.split(/\s+/) : [];
  return { command, args, raw: trimmed, isSlash: true };
}

/** 通过主名称或别名查找 SlashCmd。如果未知则返回 null。 */
export function resolveCommand(name: string): SlashCmd | null {
  const n = name.toLowerCase();
  return (
    SLASH_COMMANDS.find((c) => c.name === n) ??
    SLASH_COMMANDS.find((c) => c.aliases?.includes(n)) ??
    null
  );
}

/** 执行已解析的 slash 并返回分发结果。纯函数（无副作用）。 */
export function executeSlash(parsed: ParsedSlash, _ctx: SlashContext): SlashResult {
  const cmd = resolveCommand(parsed.command);
  if (!cmd) {
    return { kind: 'reject', message: `Unknown command: /${parsed.command}` };
  }

  switch (cmd.name) {
    // ===== Tier A — 实装 =====
    case 'compact':
      return { kind: 'submit_with_submission', submission: 'compact', message: 'Compacting context…' };
    case 'plan':
      return {
        kind: 'submit_with_submission',
        submission: 'enter_plan_mode',
        message: `Entering plan mode (task: ${parsed.args.join(' ') || 'unspecified'})…`,
      };
    case 'exit-plan':
      return { kind: 'submit_with_submission', submission: 'exit_plan_mode', message: 'Exiting plan mode…' };
    case 'goal': {
      const goalText = parsed.args.join(' ').trim();
      if (!goalText) {
        return { kind: 'reject', message: '/goal <description> — or /goal clear to exit' };
      }
      if (goalText === 'clear') {
        return { kind: 'submit_with_submission', submission: 'exit_goal_mode', message: 'Exiting goal mode…' };
      }
      // GUI 语义：/goal = 开目标会话 —— 确保有已绑定的会话,挂载自校验,
      // 并立即以目标文本作为首条消息启动循环（core 的 EnterGoalMode 只挂
      // 载控制器、不启动 turn;没有首条消息循环永不开始）。
      return {
        kind: 'submit_with_submission',
        submission: 'start_goal',
        message: `Goal mode: ${goalText}`,
      };
    }
    case 'effort': {
      const level = parsed.args[0]?.toLowerCase();
      // 上游 v1.x 起 max / ultra 为新增档位。
      if (!level || !['low', 'medium', 'high', 'max', 'ultra'].includes(level)) {
        return { kind: 'reject', message: '/effort requires: low | medium | high | max | ultra' };
      }
      return {
        kind: 'submit_with_submission',
        submission: 'set_effort',
        message: `Effort → ${level}`,
      };
    }
    case 'mode': {
      const m = parsed.args[0]?.toLowerCase();
      if (!m || !['auto', 'prompt', 'deny', 'plan', 'accept_edits', 'bubble', 'bypass'].includes(m)) {
        return { kind: 'reject', message: '/mode requires: auto | prompt | deny | plan | accept_edits | bubble | bypass' };
      }
      return {
        kind: 'submit_with_submission',
        submission: 'set_permission_mode',
        message: `Permission mode → ${m}`,
      };
    }
    case 'model':
    case 'provider':
      // 计划/供应商切换入口:Models 页(编码计划一键设默认)与 Settings → 编码计划;
      // 额度耗尽时前端 planFailover 控制器还会自动切换。
      return { kind: 'no-op', message: `Open Models (Coding Plans) or Settings → Coding Plans to change ${cmd.name}.` };
    case 'status':
      return { kind: 'no-op', message: 'See StatusBar at the bottom of the window.' };
    case 'help':
      return { kind: 'no-op', message: `Slash commands: ${SLASH_COMMANDS.length} total. Type / to browse.` };

    // ===== Tier B — 部分实装 =====
    case 'clear':
      return { kind: 'no-op', message: 'New chat — navigate to /chat.' };
    case 'resume':
      return { kind: 'no-op', message: 'Open ThreadsView (sidebar) to resume a session.' };
    case 'rename': {
      const name = parsed.args.join(' ').trim();
      if (!_ctx.activeSessionId) {
        return { kind: 'reject', message: '/rename requires an active session.' };
      }
      if (!name) {
        return { kind: 'reject', message: '/rename <new name>' };
      }
      // 实装在 Composer caller 里(需要 useSessions.rename 注入)。
      return {
        kind: 'submit_with_submission',
        submission: 'rename_session',
        message: `Renaming → "${name}"`,
      };
    }
    case 'export':
      if (!_ctx.activeSessionId) {
        return { kind: 'reject', message: '/export requires an active session.' };
      }
      return { kind: 'submit_with_submission', submission: 'export_session', message: 'Exporting…' };
    case 'interrupt':
      return { kind: 'submit_with_submission', submission: 'interrupt', message: 'Interrupting…' };

    // ===== Tier B — 轻量引导(数据已在 UI 展示) =====
    // /usage /cost /context 的数据由 StatusBar + Inspector 实时展示,
    // 这里返回引导提示而非副作用(engine 保持纯函数)。
    case 'usage':
    case 'context':
    case 'stats':
    case 'insights':
    case 'ctx_viz':
      return {
        kind: 'submit_with_submission',
        submission: 'open_usage',
        message: 'Token 用量见底部状态栏 / 右侧 Inspector 的 Token Usage。',
      };

    // v1.6.1:提示词层(/prompt)—— 打开提示词层面板并拉取可用层/生效层。
    // 面板消费 `prompt_list` 事件(reducer 写 store.prompt)。
    case 'prompt':
      return {
        kind: 'submit_with_submission',
        submission: 'prompt_list',
        message: 'Prompt layers — 查询可用层与当前生效层。',
      };

    // ===== Tier C — 路由到 settings / no-op 的 stub =====
    case 'init':
    case 'diff':
    case 'files':
    case 'branch':
    case 'commit':
    case 'commit-push-pr':
    case 'review':
    case 'ultrareview':
    case 'copy':
    case 'editor':
    case 'color':
    case 'sandbox-toggle':
    case 'memory':
    case 'hooks':
    case 'tasks':
    case 'permissions':
    case 'skills':
    case 'keybindings':
    case 'statusline':
    case 'output-style':
    case 'mcp':
    case 'plugin':
    case 'ide':
    case 'desktop':
    case 'mobile':
    case 'exit':
    case 'session':
    case 'share':
    default:
      return { kind: 'no-op', message: `/${cmd.name} — handled by Settings / dedicated view.` };
  }
}

/** 顶层分发器：一次调用完成解析与执行。 */
export function dispatch(input: string, ctx: SlashContext): SlashInput | SlashResult {
  const parsed = parseSlash(input);
  if (!parsed.isSlash) return parsed;
  // 插件命令：GUI 引擎不本地执行 —— 原样作为普通文本提交,后端 submit
  // 边界(expand_submission)按命令 md 展开。命令表来自挂载好的插件运行时
  // (usePluginCommands 同步进注册表);未挂载时引擎照旧 reject,
  // 与「未知命令」同路径,提示真实。内置命令优先 —— 插件永远无法劫持
  // `/compact` 等内置语义。
  if (resolveCommand(parsed.command) === null && isPluginCommand(parsed.command)) {
    return { raw: parsed.raw, isSlash: false };
  }
  return executeSlash(parsed, ctx);
}
