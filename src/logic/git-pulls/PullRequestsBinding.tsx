import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { zhuye_gh_pr_list, type ZhuyeGhPullRequest } from '@/utils/commands';
import type { PullRequestsViewProps } from '@/contracts/pulls';

export function PullRequestsBinding({ view: View }: { view: ComponentType<PullRequestsViewProps> }) {
  const { t, tp } = useI18n();
  const [prs, setPrs] = useState<ZhuyeGhPullRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    void zhuye_gh_pr_list(30).then((list) => { setPrs(list); setError(null); })
      .catch((cause: unknown) => { setPrs([]); setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <View t={t} tp={tp} prs={prs} error={error} loading={loading} onRefresh={refresh} />;
}
