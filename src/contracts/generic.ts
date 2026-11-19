import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';

/** 简单状态型子组件的通用展示契约。 */
export interface StatusViewProps {
  t: I18nContextValue['t'];
  text: string;
  kind?: string;
  title?: string;
  testId?: string;
}
export interface NoticeViewProps extends StatusViewProps {}
export interface PanelViewProps {
  title: string;
  subtitle?: string;
  width?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}
export type GenericComponent = ComponentType<any>;
