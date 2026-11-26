import type { I18nContextValue } from '@/utils/i18n/context';
import type { SkillMarketEntry } from '@/utils/commands/knowledge/skills';

export interface SkillRowView {
  name: string;
  path: string;
  description: string;
  bundled?: boolean;
  triggers: string[];
  tools: string[];
  whenPaths: string[];
  /** 磁盘来源推断出的目录标签(如 `agents` = .agents/skills 通用目录)。 */
  sourceLabel?: 'agents' | 'zhuye' | null;
}
export interface ToolGroupView {
  title: string;
  variant: 'neutral' | 'accent';
  tools: { name: string; description: string }[];
}
export interface SkillsViewProps {
  t: I18nContextValue['t'];
  loading: boolean;
  error: boolean;
  skills: SkillRowView[];
  toolGroups: ToolGroupView[];
  toolCount: number;
  /** 高级:任意 GitHub 仓库直装输入(单仓形态)。 */
  repo: string;
  installing: boolean;
  onRepoChange: (value: string) => void;
  onInstall: () => void;
  /** skills.sh 市场搜索词。 */
  marketQuery: string;
  /** 市场搜索结果。 */
  marketResults: SkillMarketEntry[];
  /** 搜索进行中。 */
  marketSearching: boolean;
  /** 正在安装的来源 id(空 = 无)。 */
  marketInstallingId: string;
  /** 已安装技能名集合(用于在结果上标记「已装」)。 */
  installedNames: Set<string>;
  onMarketQueryChange: (value: string) => void;
  onMarketInstall: (entry: SkillMarketEntry) => void;
  onRefreshIndex: () => void;
  refreshingIndex: boolean;
}
