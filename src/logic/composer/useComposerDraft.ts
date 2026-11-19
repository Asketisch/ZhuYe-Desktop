/**
 * useComposerDraft —— 按会话持久化 Composer 草稿（F）。
 *
 * key = `reflect.draft.<sessionId>`（新对话页用 `__new__`）。输入即写
 * localStorage；切换会话自动载入对应草稿，发送成功后清除对应草稿。此前草稿是组件内 useState，切会话/刷新即丢。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function draftKeyFor(sessionId: string | null | undefined): string {
  return `reflect.draft.${sessionId ?? '__new__'}`;
}

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* 存储不可用时静默 —— 草稿丢失可接受 */
  }
}

// ====== 跨组件预填总线 ======
//
// 首页 Hero 的快捷模板（ChatHero/quickPrompts）需要把一段 prompt 预填进
// 当前 Composer。草稿状态由 Composer 实例内的 useComposerDraft 持有，为避免
// 把状态提升到 ChatView（会破坏单一 Composer 实例约束），这里用模块级
// pub/sub：emitComposerPrefill 广播，hook 内部订阅并写入草稿；
// 追加完成后回调 options.onPrefill（Composer 用它聚焦输入框）。

type PrefillListener = (text: string) => void;
const prefillListeners = new Set<PrefillListener>();

/** 广播一段预填文本给当前挂载的 Composer（Hero 快捷模板点击时调用）。 */
export function emitComposerPrefill(text: string): void {
  for (const fn of prefillListeners) fn(text);
}

export interface ComposerDraftOptions {
  /** 预填写入草稿后的回调（聚焦输入框等副作用）。 */
  onPrefill?: (incoming: string) => void;
}

export function useComposerDraft(sessionId: string | null | undefined, options?: ComposerDraftOptions) {
  const keyRef = useRef(draftKeyFor(sessionId));
  const [text, setTextState] = useState<string>(() => readDraft(keyRef.current));
  // onPrefill 走 ref，避免调用方每次渲染的新闭包导致订阅反复重建。
  const onPrefillRef = useRef(options?.onPrefill);
  onPrefillRef.current = options?.onPrefill;

  // 切换会话：旧草稿已随每次输入写入旧 key，这里载入新 key。
  useEffect(() => {
    const nextKey = draftKeyFor(sessionId);
    if (nextKey === keyRef.current) return;
    keyRef.current = nextKey;
    setTextState(readDraft(nextKey));
  }, [sessionId]);

  const setText = useCallback(
    (next: string | ((prev: string) => string)) => {
      setTextState((prev) => {
        const value = typeof next === 'function' ? (next as (p: string) => string)(prev) : next;
        writeDraft(keyRef.current, value);
        return value;
      });
    },
    [],
  );

  // 订阅预填广播：追加写入当前会话草稿（保留用户已输入内容），再触发回调。
  useEffect(() => {
    const listener: PrefillListener = (incoming) => {
      setTextState((prev) => {
        const needsSpace = prev.length > 0 && !/\s$/.test(prev);
        const value = prev ? `${prev}${needsSpace ? ' ' : ''}${incoming}` : incoming;
        writeDraft(keyRef.current, value);
        return value;
      });
      onPrefillRef.current?.(incoming);
    };
    prefillListeners.add(listener);
    return () => {
      prefillListeners.delete(listener);
    };
  }, []);

  /** 发送完成后清除当前会话草稿。 */
  const clearDraft = useCallback(() => {
    writeDraft(keyRef.current, '');
    setTextState('');
  }, []);

  /** 仅清除仍与本次提交一致的草稿；跨路由卸载后也清理原会话的持久化值。 */
  const clearSubmittedDraft = useCallback((expected: string, session: string | null) => {
    const key = draftKeyFor(session);
    try {
      if (window.localStorage.getItem(key) === expected) window.localStorage.removeItem(key);
    } catch { /* 存储不可用时仍清理内存状态 */ }
    if (keyRef.current === key) setTextState((current) => current === expected ? '' : current);
  }, []);

  return { text, setText, clearDraft, clearSubmittedDraft };
}
