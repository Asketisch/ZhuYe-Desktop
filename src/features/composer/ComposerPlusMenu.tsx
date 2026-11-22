/**
 * ComposerPlusMenu —— 输入卡底栏左侧的「+」入口菜单。
 *
 * 一个入口收拢原先散落在底栏与 slash 弹层里的动作：
 *   - 添加文件或图片 —— 走原生文件选择器（图片同样可选）
 *   - 斜杠命令 / @ 文件引用 —— 底栏独立图标按钮收编进菜单
 *     （占位文案已教 @ / / 的打字触发，菜单入口是显式兜底）
 *   - 提示词预设 —— 仅空会话显示（会话开始后锁定，系统提示词恒定
 *     是供应商 prompt cache 命中的前提）
 *   - 技能 / 插件     —— 二级子菜单，列出已安装技能 / 已挂载插件命令
 *   - 压缩 / 目标 / 计划 —— 会话级动作（压缩立即执行，目标与计划
 *     需要补参数 → 把命令填进输入框交给用户补完）
 *
 * 菜单开合状态在本组件内（features 层）—— 渲染层不许有 hook。
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Paperclip,
  Sparkles,
  Puzzle,
  Minimize2,
  Target,
  ListChecks,
  ChevronRight,
  Plus,
  SlashSquare,
  AtSign,
  ScrollText,
} from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_list_skills } from '@/utils/commands/skills';
import { getPluginSlashCommands } from '@/logic/composer/slashCommands';
import { usePluginCommands } from '@/logic/composer/usePluginCommands';
import { useAgentStore } from '@/stores/agentStore';
import { readPromptSelection, writePromptSelection } from '@/stores/agent/promptSelection';
import type { PromptSelection } from '@/utils/commands/prompts';
import s from '@/render/composer/ComposerPlusMenu.module.css';

export interface ComposerPlusMenuProps {
  /** 打开原生文件选择器（图片同样可选）。 */
  onAttachFile: () => void;
  /** 立即执行的会话命令（如 compress → /compact）。 */
  onRunSlash: (command: string) => void;
  /** 需要用户补参数的命令 —— 把 `/cmd ` 填进输入框。 */
  onFillSlash: (command: string) => void;
  /** 把文本追加到输入框（如技能名）。 */
  onInsertText: (text: string) => void;
  /** 原底栏斜杠按钮：文本前补 `/` 并聚焦，触发命令面板。 */
  onOpenSlash: () => void;
  /** 原底栏 @ 按钮：末尾追加 `@` 并打开文件引用弹层。 */
  onMention: () => void;
}

/** 二级子菜单的归属。 */
type Submenu = 'skills' | 'plugins' | 'prompts' | null;

/** zustand selector 的稳定空引用 —— 数组字段用 `?? []` 每次新建会让
 *  useSyncExternalStore 快照永不相等而无限重渲染。 */
const NO_PROMPT_LAYERS: readonly string[] = [];

export function ComposerPlusMenu({ onAttachFile, onRunSlash, onFillSlash, onInsertText, onOpenSlash, onMention }: ComposerPlusMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 插件命令随会话 rebind 异步挂载 —— 每次挂载都重取,菜单里才是实时的。
  usePluginCommands();
  const { data: skills } = useQuery({
    queryKey: ['skills'],
    queryFn: zhuye_list_skills,
    staleTime: 30_000,
  });
  const pluginCommands = getPluginSlashCommands();

  // 提示词预设：入口只在「最初创建会话」窗口（turns 为空）显示。
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  const turnsEmpty = useAgentStore((st) => st.turns.length === 0);
  const promptAvailable = useAgentStore((st) => st.prompt?.available ?? NO_PROMPT_LAYERS);
  const promptFallback = useAgentStore((st) => st.prompt?.fallbackReason ?? null);
  const promptList = useAgentStore((st) => st.promptList);
  const [promptSelection, setPromptSelection] = useState<PromptSelection>(
    () => readPromptSelection(sessionId) ?? { mode: 'default' },
  );
  useEffect(() => { setPromptSelection(readPromptSelection(sessionId) ?? { mode: 'default' }); }, [sessionId]);
  // 可用层清单（prompt_list 事件异步回流）—— 空会话挂载时拉一次。
  // catch 防御:拉取失败不阻断菜单(选项退化为默认/智能两项)。
  useEffect(() => {
    if (turnsEmpty && useAgentStore.getState().prompt === null) {
      promptList().catch(() => { /* 清单拉不到就用默认两项 */ });
    }
  }, [turnsEmpty, promptList]);

  const pickPrompt = (value: PromptSelection) => {
    setPromptSelection(value);
    writePromptSelection(sessionId, value);
    setSubmenu(null);
  };

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  return (
    <div className={s.wrap} ref={wrapRef} data-testid="composer-plus-wrap">
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('composer.plus.hint')}
        data-testid="composer-plus"
      >
        <Icon icon={Plus} size={16} />
      </button>

      {open && (
        <div className={s.menu} role="menu" data-testid="composer-plus-menu">
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onAttachFile();
            }}
            data-testid="composer-plus-attach"
          >
            <Icon icon={Paperclip} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.attach')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onOpenSlash();
            }}
            data-testid="composer-plus-slash"
          >
            <Icon icon={SlashSquare} size={15} />
            <span className={s.itemLabel}>{t('composer.toolbar.slashCommands')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onMention();
            }}
            data-testid="composer-plus-mention"
          >
            <Icon icon={AtSign} size={15} />
            <span className={s.itemLabel}>{t('composer.toolbar.mentionFile')}</span>
          </button>

          {turnsEmpty && (
            <>
              <button
                type="button"
                role="menuitem"
                className={s.item}
                title={t('composer.controls.prompt.hint')}
                onClick={() => setSubmenu(submenu === 'prompts' ? null : 'prompts')}
                aria-expanded={submenu === 'prompts'}
                data-testid="composer-plus-prompts"
              >
                <Icon icon={ScrollText} size={15} />
                <span className={s.itemLabel}>{t('composer.controls.prompt')}</span>
                <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
              </button>
              {submenu === 'prompts' && (
                <div className={s.submenu} data-testid="composer-plus-prompts-list">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={promptSelection.mode === 'default' || undefined}
                    className={s.item}
                    onClick={() => pickPrompt({ mode: 'default' })}
                  >
                    <span className={s.itemLabel}>{t('composer.controls.prompt.follow')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={promptSelection.mode === 'auto' || undefined}
                    className={s.item}
                    title={promptFallback ?? t('composer.controls.prompt.autoHint')}
                    onClick={() => pickPrompt({ mode: 'auto' })}
                  >
                    <span className={s.itemLabel}>{t('composer.controls.prompt.auto')}</span>
                  </button>
                  {promptAvailable
                    .filter((layer) => layer !== 'default')
                    .map((layer) => (
                      <button
                        key={layer}
                        type="button"
                        role="menuitemradio"
                        aria-checked={
                          (promptSelection.mode === 'manual' && promptSelection.profile === layer) || undefined
                        }
                        className={s.item}
                        onClick={() => pickPrompt({ mode: 'manual', profile: layer })}
                      >
                        <span className={s.itemLabel}>{layer}</span>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => setSubmenu(submenu === 'skills' ? null : 'skills')}
            aria-expanded={submenu === 'skills'}
            data-testid="composer-plus-skills"
          >
            <Icon icon={Sparkles} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.skills')}</span>
            <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
          </button>
          {submenu === 'skills' && (
            <div className={s.submenu} data-testid="composer-plus-skills-list">
              {(skills ?? []).length === 0 && <span className={s.empty}>{t('composer.plus.empty')}</span>}
              {(skills ?? []).map((skill) => (
                <button
                  key={skill.name}
                  type="button"
                  role="menuitem"
                  className={s.item}
                  title={skill.description || skill.name}
                  onClick={() => {
                    close();
                    onInsertText(skill.name);
                  }}
                >
                  <span className={s.itemLabel}>{skill.name}</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => setSubmenu(submenu === 'plugins' ? null : 'plugins')}
            aria-expanded={submenu === 'plugins'}
            data-testid="composer-plus-plugins"
          >
            <Icon icon={Puzzle} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.plugins')}</span>
            <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
          </button>
          {submenu === 'plugins' && (
            <div className={s.submenu} data-testid="composer-plus-plugins-list">
              {pluginCommands.length === 0 && <span className={s.empty}>{t('composer.plus.empty')}</span>}
              {pluginCommands.map((cmd) => (
                <button
                  key={cmd.name}
                  type="button"
                  role="menuitem"
                  className={s.item}
                  title={cmd.description || cmd.name}
                  onClick={() => {
                    close();
                    onRunSlash(cmd.name);
                  }}
                >
                  <span className={s.itemLabel}>{cmd.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className={s.separator} role="separator" />

          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onRunSlash('compact');
            }}
            data-testid="composer-plus-compact"
          >
            <Icon icon={Minimize2} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.compact')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onFillSlash('goal');
            }}
            data-testid="composer-plus-goal"
          >
            <Icon icon={Target} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.goal')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onFillSlash('plan');
            }}
            data-testid="composer-plus-plan"
          >
            <Icon icon={ListChecks} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.plan')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
