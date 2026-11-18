/** 提示词方案选择、共享默认设置和正文预览。 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { reflect_get_effective_prompt, reflect_prompt_command } from '@/utils/commands/prompts';
import type { PromptSelection } from '@/utils/commands/prompts';
import { ModalShell } from './ModalShell';
import s from './PromptLayersModal.module.css';

export function PromptLayersModal() {
  const { t } = useI18n();
  const open = useAgentStore((st) => st.promptPanelOpen);
  const prompt = useAgentStore((st) => st.prompt);
  const close = useAgentStore((st) => st.closePromptPanel);
  const promptList = useAgentStore((st) => st.promptList);
  const sessionModel = useAgentStore((st) => st.session?.model ?? '');
  const promptRescan = useAgentStore((st) => st.promptRescan);
  const [showBody, setShowBody] = useState(false);
  const [selection, setSelection] = useState<PromptSelection>({ mode: 'default' });
  const previousModel = useRef(sessionModel);
  useEffect(() => {
    if (prompt?.selection) setSelection(prompt.selection);
  }, [prompt?.selection]);
  useEffect(() => {
    if (open && sessionModel && sessionModel !== previousModel.current) void promptList();
    previousModel.current = sessionModel;
  }, [open, promptList, sessionModel]);

  // 生效正文:层解析后的结果 —— 模型真正吃到的那段提示词。
  const effectiveQ = useQuery({
    queryKey: [
      'effective-prompt',
      prompt?.currentSpec,
      sessionModel,
      prompt?.selection,
      prompt?.switchedAt,
    ],
    queryFn: () => reflect_get_effective_prompt(),
    enabled: open && showBody,
    staleTime: 30_000,
  });

  const active = new Set(prompt?.activeLayers ?? []);

  return (
    <ModalShell
      title={t('promptLayers.title')}
      open={open}
      onClose={close}
      primaryAction={{
        label: t('promptLayers.rescan'),
        onClick: () => {
          // 重扫后引擎回 `prompt_switched` → reducer 更新 prompt + 弹 toast。
          void promptRescan();
          // 顺手拉一次列表:重扫可能新增/删除层文件,列表需反映最新集合。
          void promptList();
        },
        dataTestId: 'prompt-layers-rescan',
      }}
      secondaryAction={{ label: t('modal.close'), onClick: close }}
    >
      <dl className={s.meta}>
        <dt>{t('promptLayers.currentSpec')}</dt>
        <dd className={s.spec}>{prompt?.currentSpec || '—'}</dd>
      </dl>

      <section className={s.section}>
        <label htmlFor="prompt-mode">{t('promptLayers.mode')}</label>{' '}
        <select
          id="prompt-mode"
          value={selection.mode}
          onChange={(event) => {
            const mode = event.target.value;
            const selection: PromptSelection = mode === 'manual'
              ? { mode: 'manual', profile: prompt?.available.find((name) => name !== 'default') ?? 'default' }
              : { mode: mode === 'auto' ? 'auto' : 'default' };
            setSelection(selection);
            void reflect_prompt_command({ type: 'select', selection });
          }}
        >
          <option value="default">{t('promptLayers.default')}</option>
          <option value="auto">{t('promptLayers.auto')}</option>
          <option value="manual">{t('promptLayers.manual')}</option>
        </select>
        {selection.mode === 'manual' && (
          <select
            aria-label={t('promptLayers.manual')}
            value={selection.profile}
            onChange={(event) => {
              const next: PromptSelection = { mode: 'manual', profile: event.target.value };
              setSelection(next);
              void reflect_prompt_command({ type: 'select', selection: next });
            }}
          >
            {(prompt?.available ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        <p>{t('promptLayers.effectiveProfile')}: {prompt?.profile ?? 'default'}</p>
        {prompt?.fallbackReason && <p role="status">{prompt.fallbackReason}</p>}
        <button type="button" onClick={() => void reflect_prompt_command({
          type: 'save_default', selection,
        })}>{t('promptLayers.saveDefault')}</button>{' '}
        <button type="button" onClick={() => void reflect_prompt_command({ type: 'select', selection: null })}>
          {t('promptLayers.followDefault')}
        </button>
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>{t('promptLayers.activeLayers')}</h3>
        {prompt && prompt.activeLayers.length > 0 ? (
          <ul className={s.layers} data-testid="prompt-layers-active">
            {prompt.activeLayers.map((name) => (
              <li key={name} className={`${s.layer} ${s.layerActive}`}>
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.empty}>{t('promptLayers.none')}</p>
        )}
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>{t('promptLayers.availableLayers')}</h3>
        {prompt && prompt.available.length > 0 ? (
          <ul className={s.layers} data-testid="prompt-layers-available">
            {prompt.available.map((name) => (
              <li key={name} className={`${s.layer} ${active.has(name) ? s.layerActive : ''}`}>
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.empty}>{t('promptLayers.none')}</p>
        )}
      </section>

      {/* 生效正文 —— 层解析后的结果(模型真正吃到的提示词)。 */}
      <section className={s.section}>
        <button
          type="button"
          className={s.toggle}
          onClick={() => setShowBody((v) => !v)}
          data-testid="prompt-layers-toggle-body"
          aria-expanded={showBody}
        >
          {showBody ? '▾' : '▸'} {t('promptLayers.effectiveBody')}
        </button>
        {showBody && (
          <div data-testid="prompt-layers-body">
            {effectiveQ.isLoading ? (
              <p className={s.empty}>{t('common.loading')}</p>
            ) : effectiveQ.isError ? (
              <p className={s.empty}>
                {effectiveQ.error instanceof Error
                  ? effectiveQ.error.message
                  : String(effectiveQ.error)}
              </p>
            ) : (effectiveQ.data?.sections.length ?? 0) === 0 ? (
              <p className={s.empty}>{t('promptLayers.noBody')}</p>
            ) : (
              effectiveQ.data!.sections.map((sec) => (
                <div key={sec.key} className={s.bodyBlock}>
                  <code className={s.bodyKey}>{sec.key}</code>
                  <pre className={s.bodyText}>{sec.content}</pre>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <p className={s.hint}>{t('promptLayers.hint')}</p>
    </ModalShell>
  );
}
