/**
 * QuestionModal —— 多选/单选问题交互弹窗（聚焦版）。
 *
 * 行为契约(从原 modals/index.tsx 抽出,不可变):
 *   - title 为 i18n `modal.question.title`。
 *   - primary 为 Submit(autoFocus=false),onClose 走空 answers 路径。
 *   - 每个 item 渲染 question / options,checkbox vs radio 由 `multiSelect` 决定。
 *   - 提交时组装 `{ indices: [...] }` 数组 → store `answerQuestion`。
 *
 * QuestionItem/QuestionOption 仅在本文件使用,不污染外部 import 命名空间。
 */
import { useState } from 'react';
import { useAgentStore, type PendingQuestion } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from './index.module.css';

interface QuestionOption {
  label?: string;
  description?: string;
}
interface QuestionItem {
  question?: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export function QuestionModal({ question }: { question: PendingQuestion }) {
  const { t } = useI18n();
  const answerQuestion = useAgentStore((st) => st.answerQuestion);
  const payload = question.payload as { questions?: QuestionItem[] };
  const items = payload?.questions ?? [];
  const [selections, setSelections] = useState<Record<number, number[]>>({});

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
      indices: selections[qIdx] ?? [],
    }));
    return answerQuestion(question.id, { answers });
  };

  return (
    <ModalShell
      title={t('modal.question.title')}
      open={true}
      onClose={() => answerQuestion(question.id, { answers: [] })}
      primaryAction={{ label: t('modal.submit'), onClick: submit, autoFocus: false }}
    >
      {items.length === 0 && <p>{t('modal.question.empty')}</p>}
      {items.map((item, qIdx) => {
        const multi = Boolean(item.multiSelect);
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
          </div>
        );
      })}
    </ModalShell>
  );
}