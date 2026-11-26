/**
 * PromptPicker —— 底栏左侧的提示词预设 pill（权限按钮右边）。
 *
 * 会话级提示词预设偏好（per-session localStorage，null 会话走 'new'
 * 预创建键，创建后转正；bind 恢复在 ChatBinding）。入口只在「最初创建
 * 会话」窗口（turns 为空）显示 —— 会话开始后锁定，系统提示词恒定是
 * 供应商 prompt cache 命中的前提。
 *
 * v1.7 两级菜单：一级工具名（两级目录的工具组，`claude-code` 等 9 组），
 * 二级模型变体（`claude-code-opus-4.6` 等）；单变体工具渲染为一级叶项。
 * 顶部固定跟随默认 / 智能匹配模型两项。旧引擎不带 groups 时退化为
 * v1.6.1 的平铺层清单；带 groups 时平铺清单里已被组覆盖的条目（变体 id +
 * 家族层）不再重复渲染，仅剩用户自建层作为额外叶项。
 *
 * 菜单开合与二级展开交互与 ComposerPlusMenu 同款：点击开合、点击
 * 外部关闭、组项 hover/click 在右侧展开飞出子面板（hover 离开组行
 * 即收起）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readPromptSelection, writePromptSelection } from '@/stores/agent/promptSelection';
import { writePermissionPreference } from '@/stores/agent/permissionPreference';
import type { PromptSelection } from '@/utils/commands/prompts';
import s from '@/render/input/composer/PromptPicker.module.css';

/** zustand selector 的稳定空引用 —— 数组字段用 `?? []` 每次新建会让
 *  useSyncExternalStore 快照永不相等而无限重渲染。 */
const NO_PROMPT_LAYERS: readonly string[] = [];

export function PromptPicker() {
  const { t } = useI18n();
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  const turnsEmpty = useAgentStore((st) => st.turns.length === 0);
  const promptAvailable = useAgentStore((st) => st.prompt?.available ?? NO_PROMPT_LAYERS);
  const promptGroups = useAgentStore((st) => st.prompt?.groups ?? null);
  const promptFallback = useAgentStore((st) => st.prompt?.fallbackReason ?? null);
  const promptList = useAgentStore((st) => st.promptList);
  const setPermissionMode = useAgentStore((st) => st.setPermissionMode);

  const [selection, setSelection] = useState<PromptSelection>(
    () => readPromptSelection(sessionId) ?? { mode: 'default' },
  );
  useEffect(() => { setSelection(readPromptSelection(sessionId) ?? { mode: 'default' }); }, [sessionId]);

  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  // 菜单可用高度与飞出面板坐标 —— 打开时量测(viewport 坐标)。
  // 菜单自 pill 向上生长,限高到「pill 顶 − 视口顶」的空隙并滚动,
  // 否则长清单(工具分组 + 自建层)会顶出窗口被裁;飞出面板用 fixed
  // 定位逃逸菜单的滚动裁剪上下文(裁剪容器必裁 absolute 子元素)。
  const [menuMaxH, setMenuMaxH] = useState<number | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  /** 打开菜单时限高:menu 底边贴 pill 顶 − 8px,再留 8px 顶部安全距。 */
  const measureMenu = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setMenuMaxH(Math.max(180, Math.round(rect.top - 16)));
  };

  /** 展开/悬停组行时定位飞出面板:目标行右侧 6px,右侧放不下翻左侧,
   *  纵向钳到视口内(面板自身 max-height 220 + 内滚)。 */
  const openFlyout = (id: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const FLY_W = 200;
    const GAP = 6;
    const MARGIN = 8;
    const FLY_H_CAP = 240;
    let left = rect.right + GAP;
    if (left + FLY_W > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, rect.left - FLY_W - GAP);
    }
    let top = rect.top;
    if (top + FLY_H_CAP > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, window.innerHeight - FLY_H_CAP - MARGIN);
    }
    setExpandedGroup(id);
    setFlyoutPos({ top: Math.round(top), left: Math.round(left) });
  };

  // 可用层清单（prompt_list 事件异步回流）—— 空会话挂载时拉一次。
  // catch 防御:拉取失败不阻断 composer(选项退化为默认/智能两项)。
  useEffect(() => {
    if (turnsEmpty && useAgentStore.getState().prompt === null) {
      promptList().catch(() => { /* 清单拉不到就用默认两项 */ });
    }
  }, [turnsEmpty, promptList]);

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExpandedGroup(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /** 变体 id → 显示名的回查(含全部组;选中回显与 tooltip 用)。 */
  const variantIndex = useMemo(() => {
    const map = new Map<string, { label: string; group: string }>();
    for (const group of promptGroups ?? []) {
      for (const variant of group.variants) {
        map.set(variant.id, { label: variant.label, group: group.label });
      }
    }
    return map;
  }, [promptGroups]);

  /**
   * 平铺清单里的「额外叶项」:groups 存在时滤掉已被组覆盖的条目
   * (变体 id + 家族层),只剩用户自建层;旧引擎无 groups 时全部平铺。
   */
  const extraLayers = useMemo(() => {
    if (!promptGroups) {
      return promptAvailable.filter((layer) => layer !== 'default');
    }
    const covered = new Set<string>();
    for (const group of promptGroups) {
      covered.add(group.familyLayer);
      for (const variant of group.variants) covered.add(variant.id);
    }
    return promptAvailable.filter((layer) => layer !== 'default' && !covered.has(layer));
  }, [promptGroups, promptAvailable]);

  // 会话开始后锁定 —— 整个 pill 消失（渲染层无状态，直接短路）。
  if (!turnsEmpty) return null;

  const close = () => {
    setOpen(false);
    setExpandedGroup(null);
    setFlyoutPos(null);
  };
  const onPick = (raw: string) => {
    const next: PromptSelection = raw === 'default' || raw === 'auto'
      ? { mode: raw }
      : { mode: 'manual', profile: raw };
    setSelection(next);
    writePromptSelection(sessionId, next);
    // plan 预设联动工作模式:选中 /plan 即直接进入计划模式。引擎在
    // PermissionMode::Plan 下跳过 EnterPlanMode 的审批派发(tool_exec
    // 防御守卫),用户不再看到「进入计划模式?」确认框。切回非 plan
    // 预设不改模式 —— 模式入口在权限下拉(PermissionPicker)。
    // 首页(未建会话)下发的模式只落在占位线程上,首条消息建会话后的
    // 正式校准在 syncPlanPresetPermissionMode(bind → replay 为空时)。
    if (next.mode === 'manual' && next.profile === 'plan') {
      // 同时登记工作模式偏好：新会话 bind 后由
      // syncPreferredPermissionMode 校准（与 syncPlanPresetPermissionMode
      // 双保险），用户显式选择优先于预设推断。
      writePermissionPreference(sessionId, 'plan');
      setPermissionMode('plan').catch(() => { /* 占位线程未就绪等失败:建会话后会再校准 */ });
    }
    close();
  };

  // pill 回显文案:manual 变体优先用目录显示名,查不到(自建层/陈旧
  // 选择)回退原始 id。
  const currentLabel = selection.mode === 'default'
    ? t('composer.controls.prompt.follow')
    : selection.mode === 'auto'
      ? t('composer.controls.prompt.auto')
      : (variantIndex.get(selection.profile)?.label ?? selection.profile);
  const currentHint = selection.mode === 'auto' && promptFallback
    ? promptFallback
    : selection.mode === 'manual'
      ? (variantIndex.get(selection.profile)
        ? `${variantIndex.get(selection.profile)!.group} · ${variantIndex.get(selection.profile)!.label}`
        : selection.profile)
      : t('composer.controls.prompt.hint');

  const check = <Check size={13} className={s.itemCheck} aria-hidden="true" />;

  return (
    <span className={s.wrap} ref={wrapRef} data-testid="composer-prompt-picker">
      <button
        type="button"
        className={s.select}
        value={selection.mode === 'manual' ? selection.profile : selection.mode}
        onClick={() => {
          setOpen((v) => !v);
          measureMenu();
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('composer.controls.promptAria')}
        title={currentHint}
        data-testid="composer-prompt-select"
      >
        {currentLabel}
      </button>
      <ChevronDown size={12} className={s.caret} aria-hidden="true" />

      {open && (
        <div
          className={s.menu}
          role="menu"
          data-testid="composer-prompt-menu"
          style={menuMaxH ? { maxHeight: menuMaxH } : undefined}
        >
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => onPick('default')}
            data-testid="composer-prompt-default"
          >
            <span className={s.itemLabel}>{t('composer.controls.prompt.follow')}</span>
            {selection.mode === 'default' && check}
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            title={promptFallback ?? t('composer.controls.prompt.autoHint')}
            onClick={() => onPick('auto')}
            data-testid="composer-prompt-auto"
          >
            <span className={s.itemLabel}>{t('composer.controls.prompt.auto')}</span>
            {selection.mode === 'auto' && check}
          </button>

          <div className={s.separator} role="separator" />

            {(promptGroups ?? []).map((group) => (
            group.variants.length > 1 ? (
              <div
                key={group.id}
                className={s.group}
                onMouseLeave={() => setExpandedGroup(null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={s.item}
                  onClick={(e) => {
                    if (expandedGroup === group.id) setExpandedGroup(null);
                    else openFlyout(group.id, e.currentTarget);
                  }}
                  onMouseEnter={(e) => openFlyout(group.id, e.currentTarget)}
                  aria-expanded={expandedGroup === group.id}
                  aria-haspopup="menu"
                  data-testid={`composer-prompt-group-${group.id}`}
                >
                  <span className={s.itemLabel}>{group.label}</span>
                  <ChevronRight size={13} className={s.itemChevron} aria-hidden="true" />
                </button>
                {expandedGroup === group.id && (
                  <div
                    className={s.submenu}
                    data-testid={`composer-prompt-submenu-${group.id}`}
                    style={flyoutPos ? { position: 'fixed', top: flyoutPos.top, left: flyoutPos.left } : undefined}
                  >
                    {group.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        role="menuitem"
                        className={s.item}
                        title={`${group.label} · ${variant.label}`}
                        onClick={() => onPick(variant.id)}
                      >
                        <span className={s.itemLabel}>{variant.label}</span>
                        {selection.mode === 'manual' && selection.profile === variant.id && check}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                key={group.id}
                type="button"
                role="menuitem"
                className={s.item}
                onClick={() => onPick(group.variants[0].id)}
                data-testid={`composer-prompt-leaf-${group.id}`}
              >
                <span className={s.itemLabel}>{group.label}</span>
                {selection.mode === 'manual' && selection.profile === group.variants[0].id && check}
              </button>
            )
          ))}

          {extraLayers.length > 0 && (
            <>
              <div className={s.separator} role="separator" />
              {extraLayers.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  role="menuitem"
                  className={s.item}
                  title={layer}
                  onClick={() => onPick(layer)}
                >
                  <span className={s.itemLabel}>{layer}</span>
                  {selection.mode === 'manual' && selection.profile === layer && check}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </span>
  );
}
