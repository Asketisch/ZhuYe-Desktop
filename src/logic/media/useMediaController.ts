/**
 * useMediaController —— Media Studio + Computer Use Tab 控制器（Phase 3 条目 13）。
 *
 * 数据源:
 * - `reflect_list_media` —— 目录扫图(Studio tab)。
 * - `reflect_media_capabilities` —— 后端能力诊断。
 * - `reflect_screenshot` —— 截屏(返回 base64 PNG data URL)。
 * - `reflect_computer_use` —— 鼠标 / 键盘动作执行(Computer Use tab)。
 *
 * 注意:截图走独立的 `reflect_screenshot` 命令(后端 `RealComputerBackend::
 * screenshot`),**不**经 `reflect_computer_use` —— 后者把 `Screenshot` 动作
 * 显式拒绝(避免双入口)。本 controller 的 `captureScreenshot()` 是截图唯一入口。
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_list_media,
  reflect_media_capabilities,
  reflect_computer_use,
  reflect_screenshot,
  type ReflectComputerUseAction,
  type ReflectMediaAsset,
  type ReflectMediaCapabilities,
} from '@/utils/commands/media';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';

export const MEDIA_QUERY_KEY = ['media', 'assets'] as const;
const MEDIA_STALE_MS = 15_000;

export type MediaTab = 'studio' | 'computer';

export interface MediaController {
  tab: MediaTab;
  setTab: (t: MediaTab) => void;
  /** Studio 状态 */
  studioDir: string;
  setStudioDir: (d: string) => void;
  assets: ReflectMediaAsset[];
  studioLoading: boolean;
  studioError: Error | null;
  refreshStudio: () => void;
  /** Computer 状态 */
  actionHistory: ReflectComputerUseAction[];
  executeAction: (action: ReflectComputerUseAction) => Promise<void>;
  /** 截屏 —— 返回 base64 PNG data URL 并推入历史。 */
  captureScreenshot: () => Promise<string | null>;
  /** 最近一次截图的 data URL(供 UI 预览)。 */
  lastScreenshot: string | null;
  busy: boolean;
  lastError: string | null;
  /** Capabilities */
  capabilities: ReflectMediaCapabilities | null;
}

export function useMediaController(): MediaController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { t } = useI18n();
  const [tab, setTab] = useState<MediaTab>('studio');
  // 默认使用安全的 scratch 路径；用户通常会在 UI 中覆盖。
  // 空字符串使 studio 查询保持禁用状态，直到输入路径。
  const [studioDir, setStudioDir] = useState<string>('/tmp');

  const studioQ = useQuery({
    queryKey: [...MEDIA_QUERY_KEY, studioDir] as const,
    queryFn: () => reflect_list_media(studioDir),
    enabled: !!studioDir && tab === 'studio',
    staleTime: MEDIA_STALE_MS,
    retry: false,
  });

  const capsQ = useQuery({
    queryKey: ['media', 'capabilities'] as const,
    queryFn: () => reflect_media_capabilities(),
    staleTime: 60_000,
  });

  const [actionHistory, setActionHistory] = useState<ReflectComputerUseAction[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);

  const actionMut = useMutation({
    mutationFn: async (action: ReflectComputerUseAction) => {
      await reflect_computer_use(action);
    },
    onSuccess: (_data, action) => {
      pushToast({ kind: 'success', message: t('media.toastExecuted', { action: summarizeAction(action) }) });
      setActionHistory((h) => [action, ...h].slice(0, 20));
      setLastError(null);
    },
    onError: (e) => {
      const msg = String(e);
      setLastError(msg);
      pushToast({ kind: 'warn', message: msg });
    },
  });

  const screenshotMut = useMutation({
    mutationFn: async () => {
      const b64 = await reflect_screenshot();
      return b64;
    },
    onSuccess: (b64) => {
      const dataUrl = `data:image/png;base64,${b64}`;
      setLastScreenshot(dataUrl);
      // 推一条占位动作进历史(用 screenshot kind 复用渲染)。
      const shot: ReflectComputerUseAction = { kind: 'screenshot', params: null };
      setActionHistory((h) => [shot, ...h].slice(0, 20));
      setLastError(null);
      pushToast({ kind: 'success', message: t('media.toastScreenshot') });
    },
    onError: (e) => {
      const msg = String(e);
      setLastError(msg);
      pushToast({ kind: 'warn', message: msg });
    },
  });

  const refreshStudio = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [...MEDIA_QUERY_KEY] });
  }, [qc]);

  const executeAction = useCallback(
    async (action: ReflectComputerUseAction) => {
      await actionMut.mutateAsync(action);
    },
    [actionMut],
  );

  const captureScreenshot = useCallback(async () => {
    try {
      const b64 = await screenshotMut.mutateAsync();
      return b64;
    } catch {
      return null;
    }
  }, [screenshotMut]);

  return {
    tab,
    setTab,
    studioDir,
    setStudioDir,
    assets: studioQ.data ?? [],
    studioLoading: studioQ.isLoading,
    studioError: studioQ.error as Error | null,
    refreshStudio,
    actionHistory,
    executeAction,
    captureScreenshot,
    lastScreenshot,
    busy: actionMut.isPending || screenshotMut.isPending,
    lastError,
    capabilities: capsQ.data ?? null,
  };
}

function summarizeAction(a: ReflectComputerUseAction): string {
  switch (a.kind) {
    case 'screenshot':
      return 'Screenshot';
    case 'mouseMove':
      return `Mouse move (${a.params.x}, ${a.params.y})`;
    case 'mouseClick':
      return `Click (${a.params.x}, ${a.params.y})`;
    case 'keyType':
      return `Type "${a.params.text.slice(0, 20)}"`;
    case 'keyCombo':
      return `Combo ${a.params.keys}`;
    case 'scroll':
      return `Scroll (${a.params.dx}, ${a.params.dy})`;
  }
}
