/**
 * ProviderAvatar —— 模型组头像：models.dev 官方 provider 图标优先，
 * 加载失败回退字母 monogram（图标是增强不是依赖 —— 离线 / 冷门组照常可用）。
 */
import { useState } from 'react';
import { providerIconUrl } from '@/logic/settings/config/providerIcon';
import s from '@/render/harness/settings/SettingsView.module.css';

export interface ProviderAvatarProps {
  group: { id: string; label: string; endpoint: string; baseUrl: string };
  /** 展示名首字（回退 monogram）。 */
  letter: string;
}

export function ProviderAvatar({ group, letter }: ProviderAvatarProps) {
  // 每组只探测一次；失败即定格 monogram，不反复重试。
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={s.gNavAvatar}>{letter}</span>;
  }
  return (
    <span className={s.gNavAvatar}>
      <img
        src={providerIconUrl(group)}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        onError={() => setFailed(true)}
        data-testid="provider-icon"
        style={{ display: 'block', width: 18, height: 18 }}
      />
    </span>
  );
}
