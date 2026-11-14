/**
 * Vitest — useComposerInput `@` / `/` 触发器检测。
 *
 * 验证 MENTION_QUERY / SLASH_QUERY 的联动语义:
 * - `@` 后接非空白/非 `@` 序列 → mentionVisible + mentionQuery 捕获
 * - `@` 后出现空白/第二个 `@`/词首粘连 → 不触发
 * - Escape 优先关闭 slash, 其次 mention
 * - Enter 发送(与 IME composition 守卫不冲突)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useComposerInput, type UseComposerInputOptions } from './useComposerInput';
import type { PromptHistoryApi } from './usePromptHistory';

/** 最小 PromptHistoryApi 桩 —— 只让 onChange 的 isBrowsing/resetNavigation 不抛错。 */
const history: PromptHistoryApi = {
  count: 0,
  commit: vi.fn(),
  recallPrev: vi.fn(() => false),
  recallNext: vi.fn(() => false),
  isBrowsing: () => false,
  resetNavigation: vi.fn(),
  clear: vi.fn(),
};

function setup(overrides: Partial<UseComposerInputOptions> = {}) {
  const setText = vi.fn();
  const setSlashVisible = vi.fn();
  const setSlashQuery = vi.fn();
  const setMentionVisible = vi.fn();
  const setMentionQuery = vi.fn();
  const submit = vi.fn();
  const opts: UseComposerInputOptions = {
    text: '',
    setText,
    // 用对象字面量充当 RefObject;hook 只在 ArrowUp/Down 时读 .current。
    textareaRef: { current: null },
    slashVisible: false,
    setSlashVisible,
    setSlashQuery,
    mentionVisible: false,
    setMentionVisible,
    setMentionQuery,
    history,
    submit,
    ...overrides,
  } as UseComposerInputOptions;
  const { result } = renderHook(() => useComposerInput(opts));
  return { opts, setText, setSlashVisible, setSlashQuery, setMentionVisible, setMentionQuery, submit, onChange: result.current.onChange };
}

/** 构造一个最小 ChangeEvent —— onChange 只读 target.value/style。 */
function changeEvent(value: string) {
  return {
    target: { value, style: {} as CSSStyleDeclaration, scrollHeight: 24 },
  } as React.ChangeEvent<HTMLTextAreaElement>;
}

function keyEvent(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    nativeEvent: { isComposing: false },
    keyCode: 0,
    preventDefault: vi.fn(),
    ...extra,
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
}

describe('useComposerInput @ mention trigger', () => {
  it('detects a bare @ at line start and captures an empty query', () => {
    const { setMentionVisible, setMentionQuery, onChange } = setup();
    onChange(changeEvent('@'));
    expect(setMentionVisible).toHaveBeenCalledWith(true);
    expect(setMentionQuery).toHaveBeenCalledWith('');
  });

  it('detects @ after whitespace and captures the query up to the cursor', () => {
    const { setMentionVisible, setMentionQuery, onChange } = setup();
    onChange(changeEvent('read @RE'));
    expect(setMentionVisible).toHaveBeenCalledWith(true);
    expect(setMentionQuery).toHaveBeenCalledWith('RE');
  });

  it('captures a query containing dots/slashes (paths)', () => {
    const { setMentionQuery, onChange } = setup();
    onChange(changeEvent('@src/a-b.c/d.ts'));
    expect(setMentionQuery).toHaveBeenCalledWith('src/a-b.c/d.ts');
  });

  it('does not trigger when a space follows the @ (query ended)', () => {
    const { setMentionVisible, onChange } = setup();
    onChange(changeEvent('read @ done'));
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });

  it('does not trigger on @@ (second @ disambiguates)', () => {
    const { setMentionVisible, onChange } = setup();
    onChange(changeEvent('@@foo'));
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });

  it('does not trigger when @ is glued to a preceding word (no word boundary)', () => {
    const { setMentionVisible, onChange } = setup();
    onChange(changeEvent('foo@bar'));
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });

  it('closes the mention when text no longer matches', () => {
    const { setMentionVisible, onChange } = setup();
    onChange(changeEvent('@ab'));
    expect(setMentionVisible).toHaveBeenLastCalledWith(true);
    onChange(changeEvent('@ab '));
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });

  it('updates mentionQuery as the user types more', () => {
    const { setMentionQuery, onChange } = setup();
    onChange(changeEvent('@a'));
    expect(setMentionQuery).toHaveBeenLastCalledWith('a');
    onChange(changeEvent('@ab'));
    expect(setMentionQuery).toHaveBeenLastCalledWith('ab');
  });

  it('still drives the slash trigger independently of mention', () => {
    const { setSlashVisible, setSlashQuery, setMentionVisible, onChange } = setup();
    onChange(changeEvent('/comm'));
    expect(setSlashVisible).toHaveBeenLastCalledWith(true);
    // SLASH_QUERY 的捕获组含前导 `/`(与既有 SlashPopup 约定一致)。
    expect(setSlashQuery).toHaveBeenLastCalledWith('/comm');
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });
});

describe('useComposerInput Escape precedence', () => {
  it('Escape closes slash first when both are visible (mention untouched)', () => {
    const setSlashVisible = vi.fn();
    const setMentionVisible = vi.fn();
    const { result } = renderHook(() =>
      useComposerInput({
        text: '/x',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: true,
        setSlashVisible,
        setSlashQuery: vi.fn(),
        mentionVisible: true,
        setMentionVisible,
        setMentionQuery: vi.fn(),
        history,
        submit: vi.fn(),
      }),
    );
    result.current.onKeyDown(keyEvent('Escape'));
    expect(setSlashVisible).toHaveBeenLastCalledWith(false);
    // slash 分支命中即 return —— mention 保持可见, 未被本次按键改动。
    expect(setMentionVisible).not.toHaveBeenCalled();
  });

  it('Escape closes the mention when only mention is visible', () => {
    const { setMentionVisible } = setup();
    const { result } = renderHook(() =>
      useComposerInput({
        text: '@x',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: false,
        setSlashVisible: vi.fn(),
        setSlashQuery: vi.fn(),
        mentionVisible: true,
        setMentionVisible,
        setMentionQuery: vi.fn(),
        history,
        submit: vi.fn(),
      }),
    );
    result.current.onKeyDown(keyEvent('Escape'));
    expect(setMentionVisible).toHaveBeenLastCalledWith(false);
  });
});

describe('useComposerInput Enter / IME guard', () => {
  it('plain Enter submits and preventDefault', () => {
    const { submit } = setup();
    const { result } = renderHook(() =>
      useComposerInput({
        text: 'hi',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: false,
        setSlashVisible: vi.fn(),
        setSlashQuery: vi.fn(),
        mentionVisible: false,
        setMentionVisible: vi.fn(),
        setMentionQuery: vi.fn(),
        history,
        submit,
      }),
    );
    const ev = keyEvent('Enter');
    result.current.onKeyDown(ev);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('does not submit while IME composing', () => {
    const { submit } = setup();
    const { result } = renderHook(() =>
      useComposerInput({
        text: '你好',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: false,
        setSlashVisible: vi.fn(),
        setSlashQuery: vi.fn(),
        mentionVisible: false,
        setMentionVisible: vi.fn(),
        setMentionQuery: vi.fn(),
        history,
        submit,
      }),
    );
    const ev = {
      key: 'Enter',
      nativeEvent: { isComposing: true },
      keyCode: 229,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
    result.current.onKeyDown(ev);
    expect(submit).not.toHaveBeenCalled();
  });

  // v1.11 桌面#4:锁定发送(sendOnEnter=false)。
  it('lock send: plain Enter falls through (newline), no submit', () => {
    const { submit } = setup();
    const { result } = renderHook(() =>
      useComposerInput({
        text: 'hi',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: false,
        setSlashVisible: vi.fn(),
        setSlashQuery: vi.fn(),
        mentionVisible: false,
        setMentionVisible: vi.fn(),
        setMentionQuery: vi.fn(),
        history,
        submit,
        sendOnEnter: false,
      }),
    );
    const ev = keyEvent('Enter');
    result.current.onKeyDown(ev);
    expect(submit).not.toHaveBeenCalled();
    // 放行浏览器默认插入换行:不 preventDefault。
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('lock send: Cmd/Ctrl+Enter still submits', () => {
    const { submit } = setup();
    const { result } = renderHook(() =>
      useComposerInput({
        text: 'hi',
        setText: vi.fn(),
        textareaRef: { current: null },
        slashVisible: false,
        setSlashVisible: vi.fn(),
        setSlashQuery: vi.fn(),
        mentionVisible: false,
        setMentionVisible: vi.fn(),
        setMentionQuery: vi.fn(),
        history,
        submit,
        sendOnEnter: false,
      }),
    );
    const ev = keyEvent('Enter', { metaKey: true });
    result.current.onKeyDown(ev);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});
