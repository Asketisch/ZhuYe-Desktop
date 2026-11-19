import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/logic/shell/useCurrentWorkspace';
import { reflect_read_file, reflect_scan_local_ports } from '@/utils/commands';
import type { HtmlPreviewProps } from '@/contracts/htmlPreview';

/** HTML 预览绑定。 */
export function HtmlPreviewBinding({ view: View }: { view: ComponentType<HtmlPreviewProps> }) {
  const { t } = useI18n();
  const { currentWorkspace } = useCurrentWorkspace();
  const [relPath, setRelPath] = useState('');
  const [submitted, setSubmitted] = useState('');

  const fileQ = useQuery({
    queryKey: ['html-preview', submitted],
    queryFn: () => reflect_read_file(submitted),
    enabled: submitted.trim().length > 0,
    retry: false,
  });
  const portsQ = useQuery({
    queryKey: ['live-ports'],
    queryFn: () => reflect_scan_local_ports(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const content = fileQ.data?.content ?? '';
  const isHtml = /\.html?$/i.test(submitted);

  return (
    <View
      t={t}
      relPath={relPath}
      onPathChange={setRelPath}
      onOpen={() => setSubmitted(relPath.trim())}
      disabled={!relPath.trim()}
      workspace={currentWorkspace}
      content={content}
      isHtml={isHtml}
      loading={fileQ.isLoading}
      error={fileQ.isError}
      ports={portsQ.data ?? []}
    />
  );
}
