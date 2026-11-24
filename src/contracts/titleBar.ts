import type { I18nContextValue } from '@/utils/i18n/context';

/**
 * harness 标题条契约。
 *
 * 布局：rail 开关 + 工作区标题 …… 右侧动作组
 * （任务中心铃铛 / 终端 / dock 开合 / 命令面板 / 单色 / 主题）。
 * dock 档位（浏览器 / 文件 / 子代理 / 用量）只在右 dock 页签行内切换，
 * 标题条不放重复快捷入口。
 */
export interface TitleBarProps {
  t: I18nContextValue['t'];
  pathname: string;
  sessionLabel: string;
  permissionMode: string | null;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  /** ===== harness 扩展 ===== */
  /** 标题条主标题（工作区名）。 */
  workspaceLabel: string;
  /** 待处理会话数（任务中心角标，0 隐藏）。 */
  pendingCount: number;
  onToggleTerm: () => void;
  termOpen: boolean;
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  /** 单色模式：'on' = 语义色可用；'off' = 已中和。 */
  semantic: 'on' | 'off';
  onToggleSemantic: () => void;
  resolvedTheme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}
