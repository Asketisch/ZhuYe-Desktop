/**
 * useDictation —— 基于浏览器 Web Speech API 的语音识别 hook。
 *
 * Tauri Webview (macOS / Windows / Linux) 暴露 `window.SpeechRecognition` /
 * `window.webkitSpeechRecognition`。在没有该 API 的环境（headless test）下，
 * `isSupported = false`，调用方降级到 placeholder UI。
 *
 * 设计目标：
 * - 一行即可启动：`const { isListening, transcript, start, stop } = useDictation()`。
 * - 持续识别，连续 partial 转写都推到 transcript 状态里。
 * - 自动错误恢复：5xx / not-allowed 一律 stop + 状态里给提示文案。
 *
 * Browser 兼容：
 *   ✅ Chrome/Edge（macOS、Windows）走 webkitSpeechRecognition。
 *   ✅ Safari（macOS/iOS）走 webkitSpeechRecognition。
 *   ❌ Tauri Linux webkit2gtk 通常未打包 vosk → 返回 false。
 *   ❌ jsdom → 返回 false（仅在测试环境用 hook 的降级分支）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionEventLike = {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
  resultIndex: number;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
  message?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export interface DictationOptions {
  lang?: string;
  continuous?: boolean;
}

export interface DictationState {
  /** 当前浏览器/平台是否支持语音识别。 */
  isSupported: boolean;
  /** 是否正在识别中。 */
  isListening: boolean;
  /** 实时文本（interim + final 拼接）。 */
  transcript: string;
  /** 仅 final 段（已锁定的最终文本）。 */
  finalTranscript: string;
  /** 上一次错误（若有）。 */
  error: string | null;
  /** 启动识别。 */
  start: () => void;
  /** 停止识别（保留 transcript）。 */
  stop: () => void;
  /** 立刻放弃并清空 transcript。 */
  reset: () => void;
}

export function useDictation(options: DictationOptions = {}): DictationState {
  const lang = options.lang ?? 'en-US';
  const continuous = options.continuous ?? true;

  const isSupported =
    typeof window !== 'undefined' &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore: 已经 stopped
      }
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (!isSupported) {
      setError('SpeechRecognition API is not available in this environment.');
      return;
    }
    if (isListening) return;
    setError(null);
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setIsListening(true);
    rec.onerror = (e) => {
      setError(`${e.error}${e.message ? `: ${e.message}` : ''}`);
      setIsListening(false);
    };
    rec.onend = () => setIsListening(false);
    rec.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      if (final) {
        setFinalTranscript((prev) => `${prev ? `${prev} ` : ''}${final.trim()}`);
      }
      // 读取 ref（而非捕获的状态），以确保刚完成最终化的
      // segment 已包含在同一个渲染周期的 transcript 中。
      setTranscript(
        `${finalTranscriptRef.current ? `${finalTranscriptRef.current} ` : ''}${final}${interim}`.trim(),
      );
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsListening(false);
    }
  }, [continuous, isListening, isSupported, lang]);

  const reset = useCallback(() => {
    stop();
    setTranscript('');
    setFinalTranscript('');
    setError(null);
  }, [stop]);

  // 跟踪最新 finalTranscript 给 onresult 用（避免闭包过期）。
  const finalTranscriptRef = useRef('');
  useEffect(() => {
    finalTranscriptRef.current = finalTranscript;
  }, [finalTranscript]);

  // 卸载时关掉。
  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { isSupported, isListening, transcript, finalTranscript, error, start, stop, reset };
}
