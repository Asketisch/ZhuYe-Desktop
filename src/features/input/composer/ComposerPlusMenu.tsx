/**
 * ComposerPlusMenu —— 输入卡底栏左侧的「+」入口菜单。
 *
 * 一个入口收拢原先散落在底栏与 slash 弹层里的动作：
 *   - 添加文件或图片 —— 走原生文件选择器（图片同样可选）
 *   - 斜杠命令 / @ 文件引用 —— 占位文案已教 @ / / 的打字触发，
 *     菜单入口是显式兜底
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
  Lightbulb,
  Minimize2,
  Target,
  ListChecks,
  MessagesSquare,
  FileCode2,
  ChevronRight,
  Plus,
  SlashSquare,
  AtSign,
} from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_list_skills } from '@/utils/commands/skills';
import { getPluginSlashCommands } from '@/logic/composer/slashCommands';
import { usePluginCommands } from '@/logic/composer/usePluginCommands';
import { groupQuickPrompts } from '@/logic/home/quickPrompts';
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
  /** 预填一段任务模板到输入框（不自动发送）。 */
  onPrefill: (text: string) => void;
}

/** 二级子菜单的归属。 */
type Submenu = 'skills' | 'plugins' | 'suggestions' | null;

export function ComposerPlusMenu({ onAttachFile, onRunSlash, onFillSlash, onInsertText, onOpenSlash, onMention, onPrefill }: ComposerPlusMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  // 菜单限高与飞出面板坐标 —— 与 PromptPicker 同款量测口径:菜单向上
  // 生长限高到 pill 顶空隙并内滚,飞出面板 fixed 定位逃逸滚动裁剪。
  const [menuMaxH, setMenuMaxH] = useState<number | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 插件命令随会话 rebind 异步挂载 —— 每次挂载都重取,菜单里才是实时的。
  usePluginCommands();
  const { data: skills } = useQuery({
    queryKey: ['skills'],
    queryFn: zhuye_list_skills,
    staleTime: 30_000,
  });
  const pluginCommands = getPluginSlashCommands();

  /** 打开菜单时限高:menu 底边贴「+」顶 − 8px,再留 8px 顶部安全距。 */
  const measureMenu = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setMenuMaxH(Math.max(180, Math.round(rect.top - 16)));
  };

  /** 展开(点击)技能/插件行时定位飞出面板:行右侧 6px,放不下翻左侧,
   *  纵向钳到视口内。 */
  const toggleFlyout = (id: Exclude<Submenu, null>, el: HTMLElement) => {
    if (submenu === id) {
      setSubmenu(null);
      return;
    }
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
    setSubmenu(id);
    setFlyoutPos({ top: Math.round(top), left: Math.round(left) });
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
    setFlyoutPos(null);
  };

  return (
    <div className={s.wrap} ref={wrapRef} data-testid="composer-plus-wrap">
      <button
        type="button"
        className={s.trigger}
        onClick={() => {
          setOpen((v) => !v);
          measureMenu();
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('composer.plus.hint')}
        data-testid="composer-plus"
      >
        <Icon icon={Plus} size={16} />
      </button>

      {open && (
        <div
          className={s.menu}
          role="menu"
          data-testid="composer-plus-menu"
          style={menuMaxH ? { maxHeight: menuMaxH } : undefined}
        >
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

          <div className={s.group} data-testid="composer-plus-skills-group">
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={(e) => toggleFlyout('skills', e.currentTarget)}
              aria-expanded={submenu === 'skills'}
              aria-haspopup="menu"
              data-testid="composer-plus-skills"
            >
              <Icon icon={Sparkles} size={15} />
              <span className={s.itemLabel}>{t('composer.plus.skills')}</span>
              <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
            </button>
            {submenu === 'skills' && (
              <div
                className={s.submenu}
                data-testid="composer-plus-skills-list"
                style={flyoutPos ? { position: 'fixed', top: flyoutPos.top, left: flyoutPos.left } : undefined}
              >
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
          </div>

          <div className={s.group} data-testid="composer-plus-plugins-group">
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={(e) => toggleFlyout('plugins', e.currentTarget)}
              aria-expanded={submenu === 'plugins'}
              aria-haspopup="menu"
              data-testid="composer-plus-plugins"
            >
              <Icon icon={Puzzle} size={15} />
              <span className={s.itemLabel}>{t('composer.plus.plugins')}</span>
              <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
            </button>
            {submenu === 'plugins' && (
              <div
                className={s.submenu}
                data-testid="composer-plus-plugins-list"
                style={flyoutPos ? { position: 'fixed', top: flyoutPos.top, left: flyoutPos.left } : undefined}
              >
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
          </div>

          {/* ===== 建议（v1.13：四个通用任务模板的唯一入口）===== */}
          <div className={s.group} data-testid="composer-plus-suggestions-group">
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={(e) => toggleFlyout('suggestions', e.currentTarget)}
              aria-expanded={submenu === 'suggestions'}
              aria-haspopup="menu"
              title={t('composer.plus.suggestionsHint')}
              data-testid="composer-plus-suggestions"
            >
              <Icon icon={Lightbulb} size={15} />
              <span className={s.itemLabel}>{t('composer.plus.suggestions')}</span>
              <Icon icon={ChevronRight} size={13} className={s.itemChevron} />
            </button>
            {submenu === 'suggestions' && (
              <div
                className={s.submenu}
                data-testid="composer-plus-suggestions-list"
                style={flyoutPos ? { position: 'fixed', top: flyoutPos.top, left: flyoutPos.left } : undefined}
              >
                {groupQuickPrompts().map(({ group, prompts }) => (
                  <div key={group.id} className={s.suggestGroup}>
                    <span className={s.suggestGroupTitle}>{t(group.titleKey)}</span>
                    {prompts.map((prompt) => (
                      <button
                        key={prompt.id}
                        type="button"
                        role="menuitem"
                        className={s.item}
                        title={t(prompt.promptKey)}
                        onClick={() => {
                          close();
                          onPrefill(t(prompt.promptKey));
                        }}
                        data-testid={`composer-plus-suggestion-${prompt.id}`}
                      >
                        <span className={s.itemLabel}>{t(prompt.titleKey)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

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
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onFillSlash('side');
            }}
            data-testid="composer-plus-side"
          >
            <Icon icon={MessagesSquare} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.side')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              close();
              onFillSlash('init');
            }}
            data-testid="composer-plus-init"
          >
            <Icon icon={FileCode2} size={15} />
            <span className={s.itemLabel}>{t('composer.plus.init')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
