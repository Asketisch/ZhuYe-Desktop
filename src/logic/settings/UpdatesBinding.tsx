import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import {
  zhuye_check_update,
  zhuye_download_install_update,
  zhuye_relaunch_app,
  listen_update_progress,
  type ZhuyeUpdateInfo,
  type ZhuyeUpdateProgress,
} from '@/utils/commands/updates';
import type { UpdateInstallState, UpdatesSectionProps } from '@/contracts/settingsCards';
export function UpdatesBinding({ view: View }: { view: ComponentType<UpdatesSectionProps> }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<ZhuyeUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // OTA 安装状态:null = 本次会话未发起过安装。安装期间按钮不再渲染
  // (phase 非空即收起入口),无需单独的 busy 标记防双击。
  const [install, setInstall] = useState<UpdateInstallState | null>(null);
  // 事件订阅是异步 promise —— 卸载早于 resolve 时仍要能 unlisten(同终端页惯例)。
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen_update_progress((payload: ZhuyeUpdateProgress) => {
      setInstall((prev) => {
        if (payload.type === 'progress') {
          const total = payload.total;
          return {
            phase: 'downloading',
            percent: total ? Math.min(100, Math.round((payload.downloaded / total) * 100)) : null,
            error: null,
            version: prev?.version ?? null,
          };
        }
        if (payload.type === 'finished') {
          return { phase: 'installing', percent: 100, error: null, version: prev?.version ?? null };
        }
        // started:安装尚无结果,保持现状即可。
        return prev;
      });
    }).then((un) => {
      if (cancelled) un();
      else unlistenRef.current = un;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const check = async () => { setBusy(true); try { setInfo(await zhuye_check_update()); } catch (cause) { setInfo({ currentVersion: '', latestVersion: null, updateAvailable: false, releaseUrl: null, releaseNotes: null, probedAt: Date.now(), error: cause instanceof Error ? cause.message : String(cause) }); } finally { setBusy(false); } };

  // 挂载即检查一次:原生菜单「Check for Updates…」跳到设置页即完成触发,
  // 也让面板在打开时总是展示新鲜状态(探测失败不阻断 UI)。
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首挂载执行一次
  }, []);

  // 下载 → 校验 → 安装完整回路;结果/错误都落到 install 状态由视图展示。
  const installUpdate = async () => {
    setInstall({ phase: 'downloading', percent: null, error: null, version: null });
    try {
      const outcome = await zhuye_download_install_update();
      if (outcome.installed) {
        setInstall({ phase: 'done', percent: 100, error: null, version: outcome.version });
      } else {
        // 已是最新:回到未发起态,顺手刷新检查结果。
        setInstall(null);
        void check();
      }
    } catch (cause) {
      setInstall({
        phase: 'error',
        percent: null,
        error: cause instanceof Error ? cause.message : String(cause),
        version: null,
      });
    }
  };

  const relaunch = async () => {
    try { await zhuye_relaunch_app(); } catch (cause) {
      // 重启失败(极少)降级为错误展示,不打断 UI。
      setInstall((prev) => ({ phase: 'error', percent: null, error: cause instanceof Error ? cause.message : String(cause), version: prev?.version ?? null }));
    }
  };

  return (
    <View
      t={t}
      busy={busy}
      info={info}
      onCheck={() => { void check(); }}
      install={install}
      onInstall={() => { void installUpdate(); }}
      onRelaunch={() => { void relaunch(); }}
    />
  );
}
