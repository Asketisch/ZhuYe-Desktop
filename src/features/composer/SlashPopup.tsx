/**
 * SlashPopup —— `/` 命令候选弹层（CSS Modules 版）。
 *
 * v1.x P3 修复键盘导航：此前弹层自带 node keydown 监听，但焦点始终在
 * textarea（要继续输入过滤词），监听器永远收不到真实按键。现在改为
 * **受控组件** —— 选中下标由 Composer 持有，ArrowUp/Down/Enter/Tab 在
 * textarea 的 onKeyDown 里路由进来（见 useComposerInput）。
 *
 * 契约（SlashPopup.test.tsx）：
 *   - 渲染 button 元素，文本含 `/<name>`
 *   - 点击 button 调 onSelect(name)
 *   - visible=false / 无匹配时返回 null
 */
import { useEffect } from 'react';
import { filterSlashCommands } from '@/logic/composer/slashCommands';
import { useI18n } from '@/utils/i18n';
import s from '@/render/composer/SlashPopup.module.css';

interface Props {
  query: string;
  onSelect: (cmd: string) => void;
  visible: boolean;
  /** 当前键盘/hover 选中的下标（受控，Composer 持有并夹紧）。 */
  activeIdx: number;
  /** hover 变更选中项（回传 Composer）。 */
  onActiveIdxChange: (idx: number) => void;
}

export function SlashPopup({ query, onSelect, visible, activeIdx, onActiveIdxChange }: Props) {
  const { t } = useI18n();
  const filtered = filterSlashCommands(query);

  // 查询变化或列表缩短时，把选中下标夹回有效区间。
  useEffect(() => {
    if (activeIdx >= filtered.length) onActiveIdxChange(0);
  }, [filtered.length, activeIdx, onActiveIdxChange]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div className={s.popup} role="listbox" data-testid="slash-popup">
      {filtered.map((c, i) => (
        <button
          type="button"
          key={c.name}
          onMouseEnter={() => onActiveIdxChange(i)}
          onClick={() => onSelect(c.name)}
          className={s.item}
          data-active={i === activeIdx || undefined}
          role="option"
          aria-selected={i === activeIdx}
        >
          <span className={s.name}>/{c.name}</span>
          <span className={s.summary}>
            {c.description ?? t(c.summaryKey as Parameters<typeof t>[0])}
          </span>
        </button>
      ))}
    </div>
  );
}
