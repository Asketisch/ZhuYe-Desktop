import type { I18nContextValue } from '@/utils/i18n/context';

/**
 * 市场视图契约 —— harness 单色版「插件与 MCP 市场」页。
 *
 * 三种数据源(MCP server / 插件 / 技能)在控制器层归一成 `MarketCard`,
 * 展示组件只消费投影,不直接感知 IPC 形状。
 */

/** 卡片分类(过滤 seg 的四档之一;hook 目前仅插件来源可映射)。 */
export type MarketKind = 'mcp' | 'skill' | 'hook';

/** 卡片主操作类型(全部对应真实命令;null = 无操作)。 */
export type MarketAction = 'install' | 'uninstall' | 'enable' | 'disable' | null;

/** 权限行的色点基调(local 用默认灰点)。 */
export type MarketPermTone = 'rw' | 'net' | 'deny' | 'local';

/** i18n key 类型(与 useI18n 的 t 入参一致)。 */
export type MarketLocaleKey = Parameters<I18nContextValue['t']>[0];

/** 一条归一后的市场卡片。 */
export interface MarketCard {
  /** 稳定 id —— `market-card-<id>` / `market-action-<id>` testid 后缀。 */
  id: string;
  /** 分类。 */
  kind: MarketKind;
  /** 图标字形(mcp = 插头 / plugin = 拼图 / skill = 星火)。 */
  glyph: 'mcp' | 'plugin' | 'skill';
  /** 展示名。 */
  name: string;
  /** 来源行(mono):启动命令 / marketplace 名 / owner/repo。 */
  src: string;
  /** 是否已安装(已安装徽标 `.on`)。 */
  installed: boolean;
  /** 一句话说明。 */
  desc: string;
  /** 权限行(静态推导,最多 2-3 行)。 */
  perms: Array<{ tone: MarketPermTone; key: MarketLocaleKey }>;
  /** 版本号(未知为 null)。 */
  version: string | null;
  /** 工具数(部分来源可得;null = 未知,不渲染)。 */
  toolCount: number | null;
  /** 主操作;null = 只读卡片。 */
  action: MarketAction;
  /** 已安装插件的主操作之外的卸载动作(切换启停时同时可卸载)。 */
  secondary: MarketAction;
  /** 安装上下文(marketplace 名 / skill source 等载荷)。 */
  payload: Record<string, string>;
  /** 来自市场搜索命中 —— 免受本地 name/desc 过滤(它们就是搜索结果)。 */
  fromSearch?: boolean;
}

/** 市场页展示契约。 */
export interface MarketViewProps {
  t: I18nContextValue['t'];
  /** 搜索框当前值。 */
  query: string;
  /** 当前过滤档。 */
  filter: MarketKind | 'all';
  /** 归一后的卡片(已按 query + filter 过滤)。 */
  cards: MarketCard[];
  /** 头部副标题:已安装数。 */
  installedCount: number;
  /** 头部副标题:可用(未安装)数。 */
  availableCount: number;
  /** 首屏加载中。 */
  loading: boolean;
  /** 正在执行操作的卡片 id(按钮禁用)。 */
  busyId: string | null;
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: MarketKind | 'all') => void;
  onBack: () => void;
  /** 主操作(安装 / 启停 / 卸载)。 */
  onAction: (card: MarketCard) => void;
  /** 副操作(已安装插件的卸载)。 */
  onSecondary: (card: MarketCard) => void;
}
