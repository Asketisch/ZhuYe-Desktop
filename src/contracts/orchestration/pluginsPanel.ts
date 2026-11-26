import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { PluginsPanelController } from '@/logic/collaboration/usePluginsPanelController';
export interface MarketplaceRowProps { name: string; source: string; location: string; autoUpdate: boolean }
export interface PluginsPanelProps { t: I18nContextValue['t']; ctrl: PluginsPanelController; MarketplaceRow: ComponentType<MarketplaceRowProps> }

export type { ZhuyePluginScope } from '@/utils/commands';

export function pluginErrorMessage(error: unknown): string { if (error instanceof Error) return error.message; if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg; return String(error); }
