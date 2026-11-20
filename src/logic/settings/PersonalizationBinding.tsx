import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { zhuye_get_user_instructions, zhuye_save_user_instructions } from '@/utils/commands';
import type { SettingsPersonalizationProps } from '@/contracts/settingsPersonalization';

/** 个性化（用户级自定义指令）绑定：读 / 写 `<用户数据目录>/AGENTS.md`。 */
export function PersonalizationBinding({ view: View }: { view: ComponentType<SettingsPersonalizationProps> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['user-instructions'], queryFn: zhuye_get_user_instructions, staleTime: 30_000 });
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 服务端数据到位时初始化草稿；保存成功后把草稿对齐到已保存内容。
  useEffect(() => {
    if (query.data !== undefined && draft === null) setDraft(query.data);
  }, [query.data, draft]);

  const saveMut = useMutation({
    mutationFn: (content: string) => zhuye_save_user_instructions(content),
    onSuccess: (_result: unknown, content: string) => {
      setDraft(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ['user-instructions'] });
    },
  });

  const content = draft ?? query.data ?? '';
  return (
    <View
      t={t}
      content={content}
      loading={query.isLoading}
      saving={saveMut.isPending}
      saved={saved}
      dirty={draft !== null && draft !== query.data}
      error={saveMut.error instanceof Error ? saveMut.error.message : saveMut.error ? String(saveMut.error) : null}
      onChange={setDraft}
      onSave={() => saveMut.mutate(content)}
      onReset={() => setDraft(null)}
    />
  );
}
