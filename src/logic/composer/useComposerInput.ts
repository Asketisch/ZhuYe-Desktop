import { useCallback, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import type { PromptHistoryApi } from '@/logic/composer/usePromptHistory';

const SLASH_QUERY = /(^|\s)(\/\w*)$/;
/**
 * `@<query>` 触发器：行首或空白后的 `@` + 非 `@` 非空白字符序列。
 * - 不允许 `@` 出现在 query 内（避免 `@@foo` 解析歧义）
 * - 不允许空白字符在 query 内（与 `/` slash 行为一致，避免被空格提前结束）
 */
const MENTION_QUERY = /(^|\s)@([^@\s]*)$/;

export interface UseComposerInputOptions {
  text: string;
  setText: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  slashVisible: boolean;
  setSlashVisible: (visible: boolean) => void;
  setSlashQuery: (query: string) => void;
  /**
   * v1.x：`@` 弹层联动（取代 Composer 内的 useMemo 计算）。
   * - `mentionVisible = true` 时 MentionPicker 渲染；
   * - `mentionQuery` 是 `@` 后待匹配的字符串（如 `"RE"` for "读 @RE"）。
   */
  mentionVisible: boolean;
  setMentionVisible: (visible: boolean) => void;
  setMentionQuery: (query: string) => void;
  history: PromptHistoryApi;
  /** `reverseMode`：单次反转 Queue/Steer 模式发送（Shift+Cmd/Ctrl+Enter）。 */
  submit: (options?: { reverseMode?: boolean }) => void;
  /**
   * v1.11 桌面#4：锁定发送（uiPrefs.sendOnEnter）。
   * - `true`（默认 / 未传）：Enter 发送，Shift+Enter 换行（旧行为）；
   * - `false`：Enter 走浏览器默认插入换行（**不** preventDefault），
   *   发送改走 ⌘/Ctrl+Enter（或点发送按钮）。防误发。
   */
  sendOnEnter?: boolean;
  /** P3：slash 弹层键盘导航 —— 焦点保持在 textarea，由这里路由按键。 */
  onSlashNav?: (direction: 'up' | 'down') => void;
  /** P3：Enter/Tab 选中当前弹层项（返回 true 表示已消费，不再发送）。 */
  onSlashPick?: () => boolean;
}

function isCompositionEvent(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function useComposerInput({
  text,
  setText,
  textareaRef,
  slashVisible,
  setSlashVisible,
  setSlashQuery,
  mentionVisible,
  setMentionVisible,
  setMentionQuery,
  history,
  submit,
  sendOnEnter = true,
  onSlashNav,
  onSlashPick,
}: UseComposerInputOptions) {
  const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setText(value);
    if (history.isBrowsing()) history.resetNavigation();

    const slash = SLASH_QUERY.exec(value);
    setSlashVisible(Boolean(slash));
    setSlashQuery(slash?.[2] ?? '');

    const mention = MENTION_QUERY.exec(value);
    setMentionVisible(Boolean(mention));
    setMentionQuery(mention?.[2] ?? '');

    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
  }, [history, setMentionQuery, setMentionVisible, setSlashQuery, setSlashVisible, setText]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCompositionEvent(event)) return;

    // Shift+Cmd/Ctrl+Enter：单次反转 Queue/Steer 模式发送。
    if (event.key === 'Enter' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit({ reverseMode: true });
      return;
    }

    // P3：slash 弹层打开时接管 Enter/Tab/箭头 —— 选中候选而非发送；
    // 焦点保持在 textarea（继续输入过滤词）。
    if (slashVisible) {
      if (event.key === 'ArrowDown' && onSlashNav) {
        event.preventDefault();
        onSlashNav('down');
        return;
      }
      if (event.key === 'ArrowUp' && onSlashNav) {
        event.preventDefault();
        onSlashNav('up');
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && onSlashPick) {
        if (onSlashPick()) {
          event.preventDefault();
          return;
        }
      }
    }

    // v1.11 桌面#4：Enter 行为按 uiPrefs.sendOnEnter 分派。
    // - sendOnEnter=true：Enter 发送（meta/ctrl+Enter 同路径兼容旧习惯），
    //   Shift+Enter 走浏览器默认行为插入换行；
    // - sendOnEnter=false（锁定发送）：Enter **放行**浏览器默认（换行），
    //   ⌘/Ctrl+Enter 才发送。锁定时 Shift+Enter 与 Enter 等价（都换行）。
    if (event.key === 'Enter') {
      const wantSend = sendOnEnter ? !event.shiftKey : event.metaKey || event.ctrlKey;
      if (wantSend) {
        event.preventDefault();
        submit();
        return;
      }
      // 不发送：锁定模式下 Enter/Shift+Enter 都交给浏览器默认插入换行。
      if (!sendOnEnter) return;
    }

    if (event.key === 'Escape') {
      if (slashVisible) {
        setSlashVisible(false);
        return;
      }
      if (mentionVisible) {
        setMentionVisible(false);
        return;
      }
    }

    if (slashVisible || mentionVisible || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

    const element = textareaRef.current;
    if (!element) return;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    const onFirstLine = !element.value.slice(0, start).includes('\n');
    const onLastLine = !element.value.slice(end).includes('\n');

    if (event.key === 'ArrowUp' && onFirstLine) {
      if (history.recallPrev(text, setText)) event.preventDefault();
    } else if (event.key === 'ArrowDown' && onLastLine && history.isBrowsing()) {
      if (history.recallNext(setText)) event.preventDefault();
    }
  }, [history, mentionVisible, onSlashNav, onSlashPick, sendOnEnter, setMentionVisible, setSlashVisible, setText, slashVisible, submit, text, textareaRef]);

  return { onChange, onKeyDown };
}
