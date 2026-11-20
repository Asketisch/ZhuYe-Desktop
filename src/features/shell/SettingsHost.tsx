/**
 * SettingsHost —— harness 设置弹窗。
 *
 * v3 设计把设置从路由页改为模态（ms-modal 骨架）；表单内容整体复用
 * 既有 SettingsView（配置 schema / sections / 保存链路零改动）。
 * 打开入口：侧栏用户条 ⋯、「更多」菜单、⌘, 快捷键。
 */
import { SettingsView } from '@/features/settings/SettingsView';
import { X } from 'lucide-react';
import { useI18n } from '@/utils/i18n';

export function SettingsHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="modal-wrap on" data-testid="harness-settings-modal">
      <div className="modal wide">
        <div className="ms-main">
          <div className="ms-head">
            <span className="ms-title">{t('settings.title')}</span>
            <span className="tp-spacer" />
            <button
              type="button"
              className="tb-btn"
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={onClose}
              data-testid="harness-settings-close"
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <div className="ms-body flush">
            <SettingsView />
          </div>
        </div>
      </div>
    </div>
  );
}
