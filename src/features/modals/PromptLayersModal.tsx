/**
 * PromptLayersModal —— 提示词层列表(v1.6.1)。
 *
 * 提示词按模型自动匹配外置到 `.reflect/prompts/*.md`,引擎侧经
 * `Op::PromptCommand` 暴露查询与重扫:
 * - `list`   → `EventMsg::PromptList`(可用层 + 生效层 + 当前 spec)
 * - `switch` → `EventMsg::PromptSwitched`(重扫完成 + 新命中层)
 *
 * 本弹窗消费 store 的 `prompt` 投影(由 reducer 从事件写入):
 * - 「可用层」= 可被绑定的层文件名(内置厂商层 + 用户目录层);
 * - 「生效层」= 当前 spec 实际命中的用户层(内嵌厂商层不记录)。
 *
 * 当前协议只支持全量重扫(`PromptAction::Switch { layer: None }`),
 * 「聚焦某层」槽位尚未实装 —— 因此列表项不可点选,只作诊断展示。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { reflect_get_effective_prompt } from '@/utils/commands/prompts';
import { ModalShell } from './ModalShell';
import s from './PromptLayersModal.module.css';

export function PromptLayersModal() {
  const { t } = useI18n();
  const open = useAgentStore((st) => st.promptPanelOpen);
  const prompt = useAgentStore((st) => st.prompt);
  const close = useAgentStore((st) => st.closePromptPanel);
  const promptList = useAgentStore((st) => st.promptList);
  const promptRescan = useAgentStore((st) => st.promptRescan);
  const [showBody, setShowBody] = useState(false);

  // 生效正文:层解析后的结果 —— 模型真正吃到的那段提示词。
  const effectiveQ = useQuery({
    queryKey: ['effective-prompt'],
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
