/**
 * SubagentSpecsPanel —— 子代理 spec 列表 + 原始 md 编辑器。
 *
 * 子代理 spec（`~/.zhuye/subagents/*.md` 或工作区同名目录）是
 * `call_<role>` 工具的来源 —— 与 Agents 视图管的 **agent 定义**
 * （`~/.zhuye/agents/*.md`）是两套不同的东西，此前没有任何编辑面。
 *
 * 编辑器直接编辑**原始 md**（frontmatter + body）—— 文件格式本身就是
 * 核心 `parse_subagent_str` 的输入；写前由后端解析校验，非法 frontmatter
 * 直接报错不落盘。
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Trash2, Save, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Icon, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_delete_subagent_spec,
  reflect_get_subagent_spec,
  reflect_list_subagent_specs,
  reflect_save_subagent_spec,
} from '@/utils/commands/subagents';
import s from './AgentsView.module.css';

export function SubagentSpecsPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ role: string; markdown: string } | null>(null);

  const specsQ = useQuery({
    queryKey: ['subagent-specs'],
    queryFn: () => reflect_list_subagent_specs(),
    staleTime: 15_000,
  });

  const saveMut = useMutation({
    mutationFn: (v: { role: string; markdown: string }) =>
      reflect_save_subagent_spec(v.role, v.markdown),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subagent-specs'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (role: string) => reflect_delete_subagent_spec(role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subagent-specs'] }),
  });

  const specs = specsQ.data ?? [];

  const openEditor = async (role: string) => {
    try {
      const md = await reflect_get_subagent_spec(role);
      setEditing({
        role,
        markdown: md ?? `---\nname: ${role}\nrole: ${role}\n---\n`,
      });
    } catch {
      /* 读取失败 → 不打开编辑器 */
    }
  };

  return (
    <div data-testid="agents-subagent-specs">
      {editing && (
        <Card level="flat" padding="sm" className={s.specEditor} data-testid="subagent-editor">
          <div className={s.specEditorHeader}>
            <code className={s.specRole}>{editing.role}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
              data-testid="subagent-editor-cancel"
            >
              <Icon icon={X} size={12} /> {t('agents.subagents.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={saveMut.isPending}
              onClick={() =>
                void saveMut
                  .mutateAsync({ role: editing.role, markdown: editing.markdown })
                  .then(() => setEditing(null))
              }
              data-testid="subagent-editor-save"
            >
              <Icon icon={Save} size={12} /> {t('agents.subagents.save')}
            </Button>
          </div>
          <textarea
            className={s.specTextarea}
            value={editing.markdown}
            onChange={(e) => setEditing((prev) => (prev ? { ...prev, markdown: e.target.value } : prev))}
            spellCheck={false}
            aria-label={t('agents.subagents.markdown')}
            data-testid="subagent-editor-textarea"
          />
          {saveMut.isError && (
            <p className={s.specError} data-testid="subagent-editor-error">
              {(saveMut.error as Error).message}
            </p>
          )}
        </Card>
      )}

      {specsQ.isLoading ? (
        <div className={s.loading}>
          <Spinner size={18} />
        </div>
      ) : specs.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={Bot} />}
            title={t('agents.subagents.empty')}
            description={t('agents.subagents.emptyHint')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="subagent-spec-list">
          {specs.map((spec) => (
            <div key={spec.role} className={s.row} data-testid={`subagent-row-${spec.role}`}>
              <div className={s.rowMain}>
                <code className={s.rowName}>{spec.role}</code>
                <span className={s.rowDesc}>{spec.name}</span>
                <Badge variant="neutral">{spec.source}</Badge>
                {spec.model && <Badge variant="accent">{spec.model}</Badge>}
                {spec.allowedTools.length > 0 && (
                  <span className={s.rowDesc}>{spec.allowedTools.join(', ')}</span>
                )}
              </div>
              <div className={s.rowSide}>
                <div className={s.rowActions}>
                  <button
                    type="button"
                    className={s.actionBtn}
                    onClick={() => void openEditor(spec.role)}
                    title={t('agents.subagents.edit')}
                    data-testid={`subagent-edit-${spec.role}`}
                  >
                    <Icon icon={Plus} size={12} />
                  </button>
                  {spec.source === 'workspace' && (
                    <button
                      type="button"
                      className={`${s.actionBtn} ${s.actionBtnDanger}`}
                      onClick={() => void deleteMut.mutateAsync(spec.role)}
                      title={t('agents.subagents.delete')}
                      data-testid={`subagent-delete-${spec.role}`}
                    >
                      <Icon icon={Trash2} size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
