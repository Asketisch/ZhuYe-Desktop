/**
 * shellState —— v2 工作台的壳层 UI 状态(会话级,不持久化)。
 *
 * 底部分屏 / 右栏 / 侧栏的开合是**窗口布局状态**:切会话保留、刷新重置,
 * 因此放内存态 zustand 而非 uiPrefs(localStorage)。
 */
import { create } from 'zustand';

interface ZShellState {
  /** 底部分屏(终端/浏览器/预览)开合 —— chat 头部终端开关控制。 */
  bottomOpen: boolean;
  setBottomOpen: (open: boolean) => void;
  toggleBottom: () => void;
  /** 右栏检查器开合。 */
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
  toggleRight: () => void;
  /** 侧栏开合(窄屏折叠用)。 */
  sideOpen: boolean;
  toggleSide: () => void;
}

export const useZShell = create<ZShellState>((set) => ({
  bottomOpen: false,
  setBottomOpen: (open) => set({ bottomOpen: open }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  rightOpen: true,
  setRightOpen: (open) => set({ rightOpen: open }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  sideOpen: true,
  toggleSide: () => set((s) => ({ sideOpen: !s.sideOpen })),
}));
