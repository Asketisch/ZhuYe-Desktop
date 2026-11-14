/**
 * Import —— 外部 Agent 会话导入视图(v1.11 D9)。
 *
 * 引擎侧 `reflect-import` 的三个 adapter(Claude Code / Codex / ZCode)
 * 早已齐备,此前「引擎有,GUI 无」。本视图提供完整导入链:
 * 选 Harness 种类 → 发现已导入来源数量 → (可选 dry-run 预演)→ 一键导入
 * → 成功/失败逐条展示。导入后的会话在会话列表照常出现(replay 可开)。
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Button, Select, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_import_discover,
  reflect_import_sessions,
  type ImportHarnessKind,
  type ReflectImportFailure,
  type ReflectImportOutcome,
  type ReflectImportRunResult,
} from '@/utils/commands';
import s from './ImportView.module.css';

const KINDS: { value: ImportHarnessKind; labelKey: 'import.kind.claudeCode' | 'import.kind.codex' | 'import.kind.zcode' }[] = [
  { value: 'claude_code', labelKey: 'import.kind.claudeCode' },
  { value: 'codex', labelKey: 'import.kind.codex' },
  { value: 'zcode', labelKey: 'import.kind.zcode' },
];

export function ImportView() {
  const { t } = useI18n();
  const [kind, setKind] = useState<ImportHarnessKind>('claude_code');
  const [dryRun, setDryRun] = useState(true);

  const discoverQ = useQuery({
    queryKey: ['import-sources', kind],
    queryFn: () => reflect_import_discover(kind),
    staleTime: 10_000,
  });

  const importMut = useMutation({
    mutationFn: (): Promise<ReflectImportRunResult> =>
      reflect_import_sessions(kind, { dryRun, force: false }),
  });

  const sources = discoverQ.data ?? [];
  const result = importMut.data ?? null;

  return (
    <PageShell
      icon={Download}
      title={t('import.title')}
      subtitle={t('import.subtitle')}
      width="md"
    >
      <Card level="flat" padding="lg">
        <div className={s.row}>
          <span className={s.label}>{t('import.kind')}</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as ImportHarnessKind)}
            aria-label={t('import.kind')}
            data-testid="import-kind-select"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {t(k.labelKey)}
              </option>
            ))}
          </Select>
        </div>
        <div className={s.row}>
          <span className={s.label}>{t('import.discovered')}</span>
          {discoverQ.isLoading ? (
            <Spinner size={16} />
          ) : discoverQ.isError ? (
            <Badge variant="warning">{t('import.discoverFailed')}</Badge>
          ) : (
            <Badge variant="neutral" data-testid="import-source-count">
              {sources.length}
            </Badge>
          )}
        </div>
        <div className={s.row}>
          <label className={s.checkRow}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              data-testid="import-dry-run"
            />
            <span>{t('import.dryRun')}</span>
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={importMut.isPending || sources.length === 0}
            onClick={() => importMut.mutate()}
            data-testid="import-run-btn"
          >
            {importMut.isPending
              ? t('import.running')
              : dryRun
                ? t('import.preview')
                : t('import.run')}
          </Button>
        </div>
        <p className={s.hint}>{t('import.hint')}</p>
      </Card>

      {result && (
        <Card level="outlined" padding="lg" data-testid="import-result">
          <div className={s.resultHeader}>
            <strong>{dryRun ? t('import.previewTitle') : t('import.resultTitle')}</strong>
            <Badge variant="success">
              {t('import.importedCount', { count: result.imported.length })}
            </Badge>
            {result.failed.length > 0 && (
              <Badge variant="warning">
                {t('import.failedCount', { count: result.failed.length })}
              </Badge>
            )}
          </div>
          {result.imported.map((o: ReflectImportOutcome) => (
            <div key={o.source} className={s.resultRow} data-testid="import-success-row">
              <code className={s.resultSource}>{o.source}</code>
              <span className={s.resultDetail}>
                {o.turns} {t('import.turnsUnit')} · {o.records} {t('import.recordsUnit')}
              </span>
            </div>
          ))}
          {result.failed.map((f: ReflectImportFailure) => (
            <div key={f.source} className={s.resultRow} data-testid="import-failure-row">
              <code className={s.resultSource}>{f.source}</code>
              <span className={`${s.resultDetail} ${s.errorText}`}>{f.error}</span>
            </div>
          ))}
          {result.imported.length === 0 && result.failed.length === 0 && (
            <p className={s.hint}>{t('import.nothingToImport')}</p>
          )}
        </Card>
      )}
    </PageShell>
  );
}
