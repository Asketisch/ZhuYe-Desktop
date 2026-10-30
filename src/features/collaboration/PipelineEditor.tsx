/**
 * PipelineEditor —— pipeline TOML 拓扑的编辑器(边写边验 + 落盘)。
 *
 * 此前 GUI 只能**跑**一个已有的 TOML 文件 —— 想新增一个拓扑,得手写
 * 文件、跑失败才知道写错了。现在编辑器实时校验:
 * - 结构摘要(节点 / 缺 team)从 TOML 直接读出;
 * - 配置级 + wiring 级错误交由核心的 `Pipeline::from_toml` 判定
 *   (与实际运行**同一条校验路径**)。
 *
 * 落盘写 `~/.zhuye/pipelines/<name>.toml`,非法配置不落盘。
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle, AlertTriangle, GitBranch } from 'lucide-react';
import { Badge, Button, Icon, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_list_pipeline_configs,
  reflect_save_pipeline_config,
  reflect_validate_pipeline,
} from '@/utils/commands/pipeline';
import s from './CollaborationView.module.css';

/** 新建时的模板 —— 一个最小的两节点 DAG。 */
const TEMPLATE = `name = "my-pipeline"
failure_policy = "abort"

[nodes.plan]
runner = "team"

[nodes.build]
runner = "team"
depends_on = ["plan"]
`;

export function PipelineEditor() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [tomlSrc, setTomlSrc] = useState(TEMPLATE);
  const [debounced, setDebounced] = useState(TEMPLATE);

  // 校验做防抖(每敲一个字都打后端没意义)。
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(tomlSrc), 400);
    return () => window.clearTimeout(timer);
  }, [tomlSrc]);

  const filesQ = useQuery({
    queryKey: ['pipeline-configs'],
    queryFn: () => reflect_list_pipeline_configs(),
    staleTime: 15_000,
  });

  const validationQ = useQuery({
    queryKey: ['pipeline-validate', debounced],
    queryFn: () => reflect_validate_pipeline(debounced),
    staleTime: 0,
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: () => reflect_save_pipeline_config(name.trim(), tomlSrc),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pipeline-configs'] }),
  });

  const files = filesQ.data ?? [];
  const summary = validationQ.data;
  const parseError = validationQ.error instanceof Error ? validationQ.error.message : null;

  return (
    <div className={s.pipelineEditor} data-testid="pipeline-editor">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>
          <Icon icon={GitBranch} size={14} />
          {t('collaboration.pipelineEditorTitle')}
        </h3>
        {summary?.valid ? (
          <Badge variant="success">
            <Icon icon={CheckCircle} size={11} /> {t('collaboration.pipelineValid')}
          </Badge>
        ) : summary ? (
          <Badge variant="danger">
            <Icon icon={AlertTriangle} size={11} /> {t('collaboration.pipelineInvalid')}
          </Badge>
        ) : null}
      </div>

      {files.length > 0 && (
        <div className={s.mcpFormRow}>
          {files.map((f) => (
            <button
              key={f.name}
              type="button"
              className={s.orchRow}
              onClick={() => {
                setName(f.name);
                setTomlSrc(f.toml);
              }}
              data-testid={`pipeline-config-${f.name}`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <textarea
        className={s.pipelineToml}
        value={tomlSrc}
        onChange={(e) => setTomlSrc(e.target.value)}
        spellCheck={false}
        aria-label={t('collaboration.pipelineToml')}
        data-testid="pipeline-toml"
      />

      {summary && summary.nodes.length > 0 && (
        <div className={s.mcpFormRow} data-testid="pipeline-nodes">
          <span className={s.detailLabel}>{t('collaboration.pipelineNodes')}</span>
          {summary.nodes.map((n) => (
            <Badge key={n} variant={summary.missingTeams.includes(n) ? 'warning' : 'neutral'}>
              {n}
            </Badge>
          ))}
        </div>
      )}
      {summary && summary.missingTeams.length > 0 && (
        <p className={s.errorText} data-testid="pipeline-missing-teams">
          {t('collaboration.pipelineMissingTeams', {
            teams: summary.missingTeams.join(', '),
          })}
        </p>
      )}
      {parseError && (
        <p className={s.errorText} data-testid="pipeline-parse-error">
          {parseError}
        </p>
      )}
      {summary && !summary.valid && summary.error && (
        <p className={s.errorText} data-testid="pipeline-validation-error">
          {summary.error}
        </p>
      )}

      <div className={s.mcpFormRow}>
        <input
          className={s.orchForm}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('collaboration.pipelineNamePlaceholder')}
          aria-label={t('collaboration.pipelineName')}
          data-testid="pipeline-name"
        />
        <Button
          size="sm"
          variant="primary"
          disabled={saveMut.isPending || !name.trim() || !summary?.valid}
          onClick={() => void saveMut.mutate()}
          data-testid="pipeline-save"
        >
          <Icon icon={Save} size={12} /> {t('collaboration.pipelineSave')}
        </Button>
        {saveMut.isPending && <Spinner size={12} />}
        {saveMut.isError && (
          <span className={s.errorText} data-testid="pipeline-save-error">
            {(saveMut.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}
