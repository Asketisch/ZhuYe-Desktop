/**
 * MentionPicker —— `@` 弹层（v1.x：当前工作区文件浅层列表）。
 *
 * 数据源：`listDirForMention(2)`（薄包装 `zhuye_list_dir`，后端已跳过 dotfile /
 * node_modules / target / dist / .git）。
 *
 * 路径语义：后端 `DirEntry.path` 是**绝对路径**；本层在过滤前剥离
 * `listing.root` 前缀（前缀不匹配时原样透传），`onPickFile` 与 hint 展示
 * 均为**工作区相对路径** —— 协议契约：`UserInputItem.File.path` 相对路径。
 *
 * 选择语义：仅文件可被选取（`kind === 'file'`）；目录作为路径前缀可作为
 * 子匹配的锚点（fuzzy hint），但不出现在选项中，避免误选目录名却无文件内容。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  listDirForMention,
  type ZhuyeDirEntry,
  type ZhuyeDirListing,
} from '@/utils/commands';
import { fuzzy } from '@/logic/input/fuzzy';
import { useI18n } from '@/utils/i18n';
import s from '@/render/input/composer/MentionPicker.module.css';

export interface MentionPickerProps {
  visible: boolean;
  query: string;
  /** 选中文件路径（相对当前 workspace）。 */
  onPickFile: (path: string) => void;
  onClose: () => void;
  /** 当前工作区名（仅展示用）。 */
  workspaceLabel?: string;
}

const MAX_RESULTS = 50;

export function MentionPicker({
  visible,
  query,
  onPickFile,
  onClose,
  workspaceLabel,
}: MentionPickerProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ZhuyeDirEntry[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    listDirForMention(2)
      .then((listing: ZhuyeDirListing) => {
        if (!alive) return;
        setEntries(listing.entries);
        setRoot(listing.root);
      })
      .catch(() => {
        if (alive) setEntries([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  // 绝对路径 → 工作区相对路径（前缀不匹配时原样透传,兼容测试 mock 的相对路径）。
  const files = useMemo(() => {
    const prefix = root ? `${root}/` : null;
    return entries
      .filter((e) => e.kind === 'file')
      .map((e) =>
        prefix && e.path.startsWith(prefix)
          ? { ...e, path: e.path.slice(prefix.length) }
          : e,
      );
  }, [entries, root]);

  const filtered = useMemo(() => {
    if (!query) {
      // 无 query 时按 path 字典序展示前 MAX_RESULTS 条 —— 给用户一个稳定的初始视图。
      return [...files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, MAX_RESULTS);
    }
    return fuzzy(query, files, {
      getLabel: (e) => e.name,
      getHint: (e) => e.path,
    })
      .slice(0, MAX_RESULTS)
      .map((h) => h.item);
  }, [files, query]);

  if (!visible) return null;

  return (
    <div
      className={s.popup}
      role="listbox"
      aria-label={t('composer.mentionPicker.ariaLabel')}
      data-testid="mention-picker"
    >
      {workspaceLabel && <div className={s.hint}>{workspaceLabel}</div>}
      {loading ? (
        <div className={s.empty}>{t('composer.mentionPicker.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}>{t('composer.mentionPicker.empty')}</div>
      ) : (
        filtered.map((e) => (
          <button
            key={e.path}
            type="button"
            role="option"
            className={s.item}
            onClick={() => {
              onPickFile(e.path);
              onClose();
            }}
            data-testid={`mention-file-${e.name}`}
          >
            <div className={s.name}>{e.name}</div>
            <div className={s.desc}>{e.path}</div>
          </button>
        ))
      )}
    </div>
  );
}
