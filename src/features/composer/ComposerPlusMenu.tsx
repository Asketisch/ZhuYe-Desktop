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
  Minimize2,
  Target,
  ListChecks,
  ChevronRight,
  Plus,
  SlashSquare,
  AtSign,
} from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_list_skills } from '@/utils/commands/skills';
import { getPluginSlashCommands } from '@/logic/composer/slashCommands';
import { usePluginCommands } from '@/logic/composer/usePluginCommands';
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
type Submenu = 'skills' | 'plugins' | null;

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
