/**
 * ErrorBoundary —— 路由出口的渲染错误边界。
 *
 * 没有它,任一视图在 render 阶段抛错会把整棵 React 树卸掉:用户看到
 * 白屏,只能重启应用。包住 `<Outlet />` 后,错误被限制在主内容区 ——
 * 侧栏 / 活动栏 / 状态栏保持可用,用户还能切走、换会话或重试。
 *
 * 只捕 **render 阶段**的错误;事件处理器里的错误不经过这里(走 toast)。
 * 类组件拿不到 hooks,fallback 通过渲染属性注入(文案/i18n 由
 * [`ViewErrorBoundary`] 包装层提供)。
 */
import React, { type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';

import { useI18n } from '@/utils/i18n';
import s from './ErrorBoundary.module.css';

type FallbackRenderer = (error: Error, retry: () => void) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: FallbackRenderer;
  /** 变化即复位错误态(传当前路由路径):切走坏视图后,其它路由不受牵连。 */
  resetKey: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 与后端日志同源的 console 通道 —— 白屏类问题在现场至少留一条线索。
    console.error('[reflect-gui] view render error:', error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback(error, this.retry);
  }
}

/** 带设计系统样式与 i18n 文案的默认包装;`AppShell` 挂在 `<Outlet />` 外层。 */
export function ViewErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = useLocation({ select: (l) => l.pathname });
  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={(error, retry) => (
        <div className={s.fallback} role="alert" data-testid="view-error-boundary">
          <h2 className={s.title}>{t('shell.errorBoundary.title')}</h2>
          <p className={s.desc}>{error.message || String(error)}</p>
          <button type="button" className={s.retry} onClick={retry}>
            {t('shell.errorBoundary.retry')}
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
