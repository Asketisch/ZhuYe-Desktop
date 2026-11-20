/**
 * 市场控制器 —— harness 单色版「插件与 MCP 市场」页的编排 hook。
 *
 * 三种数据源归一成 `MarketCard` 投影:
 *   - MCP server(`zhuye_list_mcp_servers`)→ kind 'mcp',已安装;
 *   - 插件(已装 `zhuye_list_plugins` + 各 marketplace 清单
 *     `zhuye_browse_marketplace`)→ 按 type/category/tags 映射
 *     mcp/skill/hook,缺省 'mcp';
 *   - 技能(已装 `zhuye_list_skills`;搜索时叠加 skills.sh 市场结果
 *     `zhuye_search_skill_market`)→ kind 'skill'。
 *
 * 突变全部走真实命令,成功/失败经 toast 反馈,并失效对应查询。
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zhuye_list_mcp_servers,
  zhuye_delete_mcp_server,
  zhuye_list_plugins,
  zhuye_list_marketplaces,
  zhuye_browse_marketplace,
  zhuye_toggle_plugin,
  zhuye_uninstall_plugin,
  zhuye_install_from_marketplace,
  zhuye_list_skills,
  zhuye_search_skill_market,
  zhuye_install_skill_from_market,
  type McpServerInfo,
  type ZhuyeMarketplacePluginInfo,
  type ZhuyePluginScope,
} from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import type { MarketCard, MarketKind, MarketPermTone } from '@/contracts/market';

// ====== 查询键(突变后按前缀失效) ======
export const MARKET_MCP_KEY = ['market', 'mcp'] as const;
export const MARKET_PLUGINS_KEY = ['market', 'plugins'] as const;
export const MARKET_MARKETPLACES_KEY = ['market', 'marketplaces'] as const;
export const MARKET_MARKETPLACE_ITEMS_KEY = ['market', 'marketplace-items'] as const;
export const MARKET_SKILLS_KEY = ['market', 'skills'] as const;

/** 已装数据一律直读;市场清单 / 搜索结果给 1min 防抖。 */
const MARKET_STALE_MS = 60_000;

// ====== 防御式载荷解析辅助(线外字段缺省 / 形状漂移时不炸) ======

function asTrimmed(v: unknown, fallback = ''): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : fallback;
}

/** 插件 scope 线外值校验(非法回退 'user',保证 uninstall 不被拒)。 */
function parseScope(v: unknown): ZhuyePluginScope {
  return v === 'managed' || v === 'user' || v === 'project' || v === 'local' ? v : 'user';
}

/**
 * 从插件形态字段探测 kind —— type/pluginType/kind/category/tags 里命中
 * 关键词即映射;都没有时按任务约定回退 'mcp'。
 */
function detectPluginKind(info: Record<string, unknown>): MarketKind {
  const tags = Array.isArray(info.tags) ? info.tags : [];
  const hay = [info.type, info.pluginType, info.kind, info.category, ...tags]
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.toLowerCase());
  if (hay.some((s) => s.includes('skill'))) return 'skill';
  if (hay.some((s) => s.includes('hook'))) return 'hook';
  return 'mcp';
}

function kindGlyph(kind: MarketKind): MarketCard['glyph'] {
  return kind === 'skill' ? 'skill' : kind === 'hook' ? 'plugin' : 'mcp';
}

function kindPerms(kind: MarketKind): Array<{ tone: MarketPermTone; key: string }> {
  // 静态推导:MCP 走网络;插件读写文件;技能仅本地执行。
  if (kind === 'mcp') return [{ tone: 'net', key: 'harness.market.permNet' }];
  if (kind === 'hook') return [{ tone: 'rw', key: 'harness.market.permRw' }];
  return [{ tone: 'local', key: 'harness.market.permLocal' }];
}

/** stdio / http 地址摘要(mono 来源行)。 */
function mcpEndpoint(server: McpServerInfo): string {
  if (asTrimmed(server.command)) return server.command as string;
  if (asTrimmed(server.url)) return server.url as string;
  return server.transport;
}

// ====== 控制器 ======

export interface UseMarketControllerResult {
  query: string;
  filter: MarketKind | 'all';
  cards: MarketCard[];
  installedCount: number;
  availableCount: number;
  loading: boolean;
  busyId: string | null;
  setQuery: (v: string) => void;
  setFilter: (f: MarketKind | 'all') => void;
  runAction: (card: MarketCard, action: Exclude<MarketCard['action'], null>) => Promise<void>;
}

export function useMarketController(): UseMarketControllerResult {
  const qc = useQueryClient();
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MarketKind | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── 三源查询 ──
  const mcpQ = useQuery({ queryKey: [...MARKET_MCP_KEY], queryFn: zhuye_list_mcp_servers });
  const pluginsQ = useQuery({ queryKey: [...MARKET_PLUGINS_KEY], queryFn: zhuye_list_plugins });
  const skillsQ = useQuery({ queryKey: [...MARKET_SKILLS_KEY], queryFn: zhuye_list_skills });
  const marketplacesQ = useQuery({
    queryKey: [...MARKET_MARKETPLACES_KEY],
    queryFn: zhuye_list_marketplaces,
    staleTime: MARKET_STALE_MS,
  });

  const marketplaces = useMemo(() => (Array.isArray(marketplacesQ.data) ? marketplacesQ.data : []), [marketplacesQ.data]);

  // 逐个 marketplace 浏览;市场未注册 / 缓存未物化时 reject(allSettled 吞掉)。
  const marketplaceItemsQ = useQuery({
    queryKey: [...MARKET_MARKETPLACE_ITEMS_KEY, marketplaces.map((m) => m.name)],
    queryFn: async (): Promise<Array<{ marketplace: string; item: ZhuyeMarketplacePluginInfo }>> => {
      const settled = await Promise.allSettled(marketplaces.map((m) => zhuye_browse_marketplace(m.name)));
      return settled.flatMap((r, i) => {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return [];
        return r.value
          .filter((item): item is ZhuyeMarketplacePluginInfo => Boolean(item && asTrimmed(item.name)))
          .map((item) => ({ marketplace: marketplaces[i]?.name ?? '', item }));
      });
    },
    enabled: marketplacesQ.isSuccess,
    staleTime: MARKET_STALE_MS,
  });

  // 搜索词 ≥2 字符才打 skills.sh 市场(后端对短词直接回空)。
  const trimmedQuery = query.trim();
  const skillSearchQ = useQuery({
    queryKey: ['market', 'skill-search', trimmedQuery],
    queryFn: () => zhuye_search_skill_market(trimmedQuery, 50),
    enabled: trimmedQuery.length >= 2,
    staleTime: MARKET_STALE_MS,
  });

  const skills = useMemo(() => (Array.isArray(skillsQ.data) ? skillsQ.data : []), [skillsQ.data]);
  const installedSkillNames = useMemo(() => new Set(skills.map((s) => s.name)), [skills]);

  // ── 归一卡片 ──
  const cards = useMemo<MarketCard[]>(() => {
    const out: MarketCard[] = [];

    // 1) MCP server:全部视为已安装;来源行 = 启动命令 / URL;副标题 = 运行态。
    for (const server of Array.isArray(mcpQ.data) ? mcpQ.data : []) {
      if (!server || !asTrimmed(server.name)) continue;
      out.push({
        id: `mcp:${server.name}`,
        kind: 'mcp',
        glyph: 'mcp',
        name: server.name,
        src: mcpEndpoint(server),
        installed: true,
        desc: `${t(server.running ? 'harness.market.running' : 'harness.market.stopped')} · ${server.transport}`,
        perms: kindPerms('mcp'),
        version: null,
        // 线上没有逐 server 工具数命令;字段万一出现(防御式)则透传。
        toolCount: typeof (server as unknown as Record<string, unknown>).toolCount === 'number'
          ? (server as unknown as Record<string, unknown>).toolCount as number
          : null,
        action: 'uninstall',
        secondary: null,
        payload: {},
      });
    }

    // 2) 已安装插件:启停 + 卸载;kind 按类型字段映射,缺省 'mcp'。
    for (const plugin of Array.isArray(pluginsQ.data) ? pluginsQ.data : []) {
      if (!plugin || !asTrimmed(plugin.id)) continue;
      const kind = detectPluginKind(plugin as unknown as Record<string, unknown>);
      out.push({
        id: `plugin:${plugin.id}`,
        kind,
        glyph: kindGlyph(kind),
        name: plugin.id,
        src: `scope:${plugin.scope}`,
        installed: true,
        desc: asTrimmed(plugin.installPath) || plugin.id,
        perms: kindPerms(kind),
        version: asTrimmed(plugin.version) || null,
        toolCount: null,
        action: plugin.enabled ? 'disable' : 'enable',
        secondary: 'uninstall',
        payload: { scope: parseScope(plugin.scope) },
      });
    }

    // 3) marketplace 可安装清单(未安装 → 安装)。
    for (const entry of Array.isArray(marketplaceItemsQ.data) ? marketplaceItemsQ.data : []) {
      const kind = detectPluginKind(entry.item as unknown as Record<string, unknown>);
      out.push({
        id: `market:${entry.marketplace}:${entry.item.name}`,
        kind,
        glyph: kindGlyph(kind),
        name: entry.item.name,
        src: asTrimmed(entry.marketplace) || 'marketplace',
        installed: false,
        desc: asTrimmed(entry.item.description) || entry.item.name,
        perms: kindPerms(kind),
        version: asTrimmed(entry.item.version ?? undefined) || null,
        toolCount: null,
        action: 'install',
        secondary: null,
        payload: { marketplace: entry.marketplace, plugin: entry.item.name },
      });
    }

    // 4) 已安装技能:无卸载命令,只读卡片。
    for (const skill of skills) {
      if (!skill || !asTrimmed(skill.name)) continue;
      out.push({
        id: `skill:${skill.name}`,
        kind: 'skill',
        glyph: 'skill',
        name: skill.name,
        src: skill.bundled ? 'bundled' : skill.pluginId ? `plugin:${skill.pluginId}` : 'skills',
        installed: true,
        desc: asTrimmed(skill.description) || skill.name,
        perms: kindPerms('skill'),
        version: asTrimmed(skill.version ?? undefined) || null,
        toolCount: null,
        action: null,
        secondary: null,
        payload: {},
      });
    }

    // 5) skills.sh 搜索结果(有搜索词才出现):slug 命中已装技能 → 已安装。
    for (const entry of Array.isArray(skillSearchQ.data) ? skillSearchQ.data : []) {
      if (!entry || !asTrimmed(entry.id)) continue;
      const installed = installedSkillNames.has(entry.slug);
      out.push({
        id: `skmarket:${entry.id}`,
        kind: 'skill',
        glyph: 'skill',
        name: asTrimmed(entry.slug) || entry.id,
        src: asTrimmed(entry.source) || 'skills.sh',
        installed,
        desc: t('harness.market.skillMarket') + (entry.official ? ' · official' : ''),
        perms: kindPerms('skill'),
        version: null,
        toolCount: null,
        action: installed ? null : 'install',
        secondary: null,
        payload: { source: entry.id },
        fromSearch: true,
      });
    }

    return out;
  }, [mcpQ.data, pluginsQ.data, marketplaceItemsQ.data, skills, skillSearchQ.data, installedSkillNames, t]);

  // ── 过滤 + 本地搜索(名称 / 说明;市场搜索命中免本地过滤) ──
  const visible = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return cards.filter((card) => {
      if (filter !== 'all' && card.kind !== filter) return false;
      if (!q || card.fromSearch) return true;
      return card.name.toLowerCase().includes(q) || card.desc.toLowerCase().includes(q);
    });
  }, [cards, filter, trimmedQuery]);

  const installedCount = useMemo(() => cards.filter((c) => c.installed).length, [cards]);
  const availableCount = useMemo(() => cards.filter((c) => !c.installed).length, [cards]);

  // ── 突变(成功后失效对应查询) ──
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => zhuye_toggle_plugin(id, enabled),
    onSuccess: (_ok, vars) => {
      void qc.invalidateQueries({ queryKey: [...MARKET_PLUGINS_KEY] });
      pushToast({ kind: 'success', message: t(vars.enabled ? 'harness.market.toastEnabled' : 'harness.market.toastDisabled') });
    },
  });
  const uninstallMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: ZhuyePluginScope }) => zhuye_uninstall_plugin(id, scope),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...MARKET_PLUGINS_KEY] });
      pushToast({ kind: 'success', message: t('harness.market.toastUninstalled') });
    },
  });
  const installPluginMut = useMutation({
    mutationFn: ({ marketplace, plugin }: { marketplace: string; plugin: string }) =>
      zhuye_install_from_marketplace(marketplace, plugin),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...MARKET_PLUGINS_KEY] });
      void qc.invalidateQueries({ queryKey: [...MARKET_MARKETPLACE_ITEMS_KEY] });
      pushToast({ kind: 'success', message: t('harness.market.toastPluginInstalled') });
    },
  });
  const installSkillMut = useMutation({
    mutationFn: (source: string) => zhuye_install_skill_from_market(source),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...MARKET_SKILLS_KEY] });
      pushToast({ kind: 'success', message: t('harness.market.toastSkillInstalled') });
    },
  });
  const deleteMcpMut = useMutation({
    mutationFn: (name: string) => zhuye_delete_mcp_server(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...MARKET_MCP_KEY] });
      pushToast({ kind: 'success', message: t('harness.market.toastMcpRemoved') });
    },
  });

  const failToast = useCallback(
    (e: unknown) => {
      const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'msg' in e ? String((e as { msg: unknown }).msg) : String(e);
      pushToast({ kind: 'error', message: t('harness.market.toastFailed', { message }) });
    },
    [pushToast, t],
  );

  /** 统一动作入口:按卡片 action / kind 分派到真实命令。 */
  const runAction = useCallback(
    async (card: MarketCard, action: Exclude<MarketCard['action'], null>) => {
      setBusyId(card.id);
      try {
        if (action === 'install') {
          if (card.kind === 'skill') {
            await installSkillMut.mutateAsync(card.payload.source ?? card.name);
          } else {
            await installPluginMut.mutateAsync({
              marketplace: card.payload.marketplace ?? '',
              plugin: card.payload.plugin ?? card.name,
            });
          }
        } else if (action === 'uninstall') {
          // 按 id 前缀分派而非 kind:插件的 kind 缺省也是 'mcp'。
          if (card.id.startsWith('mcp:')) {
            await deleteMcpMut.mutateAsync(card.name);
          } else {
            await uninstallMut.mutateAsync({ id: card.name, scope: parseScope(card.payload.scope) });
          }
        } else if (action === 'enable' || action === 'disable') {
          await toggleMut.mutateAsync({ id: card.name, enabled: action === 'enable' });
        }
      } catch (e) {
        failToast(e);
      } finally {
        setBusyId(null);
      }
    },
    [deleteMcpMut, failToast, installPluginMut, installSkillMut, toggleMut, uninstallMut],
  );

  return {
    query,
    filter,
    cards: visible,
    installedCount,
    availableCount,
    loading: mcpQ.isLoading || pluginsQ.isLoading || skillsQ.isLoading,
    busyId,
    setQuery,
    setFilter,
    runAction,
  };
}
