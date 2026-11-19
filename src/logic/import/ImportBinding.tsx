import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { reflect_import_discover, reflect_import_sessions } from '@/utils/commands';
import type { ImportKindOption, ImportViewProps } from '@/contracts/importView';

const KINDS: ImportKindOption[] = [
  { value: 'claude_code', labelKey: 'import.kind.claudeCode' },
  { value: 'codex', labelKey: 'import.kind.codex' },
  { value: 'zcode', labelKey: 'import.kind.zcode' },
];

/** 外部会话导入绑定。 */
export function ImportBinding({ view: View }: { view: ComponentType<ImportViewProps> }) {
  const { t } = useI18n();
  const [kind, setKind] = useState('claude_code');
  const [dryRun, setDryRun] = useState(true);

  const discoverQ = useQuery({
    queryKey: ['import-sources', kind],
    queryFn: () => reflect_import_discover(kind as 'claude_code' | 'codex' | 'zcode'),
    staleTime: 10_000,
  });
  const importMut = useMutation({ mutationFn: () => reflect_import_sessions(kind as 'claude_code' | 'codex' | 'zcode', { dryRun, force: false }) });

  const sources = discoverQ.data ?? [];
  return (
    <View
      t={t}
      kinds={KINDS}
      kind={kind}
      onKindChange={setKind}
      dryRun={dryRun}
      onDryRunChange={setDryRun}
      sourcesCount={discoverQ.isError ? null : sources.length}
      discoverLoading={discoverQ.isLoading}
      running={importMut.isPending}
      disabled={importMut.isPending || sources.length === 0}
      result={importMut.data ? { imported: importMut.data.imported, failed: importMut.data.failed } : null}
      onImport={() => importMut.mutate()}
    />
  );
}
