/**
 * QuestionModal —— 多选/单选问题交互弹窗（聚焦版）。
 *
 * 行为契约(从原 modals/index.tsx 抽出,不可变):
 *   - title 为 i18n `modal.question.title`。
 *   - 选项模式和回执遵循协议的 `multi_select` / `selected` 字段。
 *   - 每题支持可选的自定义答案；关闭时逐题发送空答案。
 */
import { useState } from 'react';
import { Input } from '@/features/design-system';
import { useAgentStore, type PendingQuestion } from '@/stores/agentStore';
import type { Question } from '@/types/protocol';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from './index.module.css';

export function QuestionModal({ question }: { question: PendingQuestion }) {
  const { t } = useI18n();
  const answerQuestion = useAgentStore((st) => st.answerQuestion);
  const payload = question.payload as { questions?: Question[] };
  const items = payload?.questions ?? [];
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  const toggle = (qIdx: number, optIdx: number, multi: boolean) => {
    setSelections((prev) => {
      const cur = prev[qIdx] ?? [];
      if (multi) {
        return { ...prev, [qIdx]: cur.includes(optIdx) ? cur.filter((i) => i !== optIdx) : [...cur, optIdx] };
      }
      return { ...prev, [qIdx]: [optIdx] };
    });
  };

  const submit = () => {
    const answers = items.map((_, qIdx) => ({
      selected: selections[qIdx] ?? [],
      ...(customAnswers[qIdx]?.trim() ? { custom: customAnswers[qIdx].trim() } : {}),
    }));
    return answerQuestion(question.id, { answers });
  };

  return (
    <ModalShell
      title={t('modal.question.title')}
      open={true}
      onClose={() => answerQuestion(question.id, { answers: items.map(() => ({ selected: [] })) })}
      primaryAction={{ label: t('modal.submit'), onClick: submit, autoFocus: false }}
    >
      {items.length === 0 && <p>{t('modal.question.empty')}</p>}
      {items.map((item, qIdx) => {
        const multi = item.multi_select;
        return (
          <div key={qIdx} className={s.questionItem}>
            <p className={s.questionText}>{item.question ?? item.header ?? t('modal.question.fallback', { n: qIdx + 1 })}</p>
            <div className={s.optionList}>
              {(item.options ?? []).map((opt, optIdx) => {
                const checked = (selections[qIdx] ?? []).includes(optIdx);
                return (
                  <label key={optIdx} className={s.option}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`q-${question.id}-${qIdx}`}
                      checked={checked}
                      onChange={() => toggle(qIdx, optIdx, multi)}
                      className={s.optionInput}
                    />
                    <span className={s.optionLabel}>{opt.label ?? t('modal.question.option', { n: optIdx + 1 })}</span>
                    {opt.description && (
                      <span className={s.optionDesc}>— {opt.description}</span>
                    )}
                  </label>
                );
              })}
            </div>
            <Input
              type="text"
              className={s.otherInput}
              aria-label={`${t('modal.question.other')} — ${item.question || item.header}`}
              placeholder={t('modal.question.other')}
              value={customAnswers[qIdx] ?? ''}
              onChange={(event) => setCustomAnswers((prev) => ({ ...prev, [qIdx]: event.target.value }))}
            />
          </div>
        );
      })}
    </ModalShell>
  );
}
