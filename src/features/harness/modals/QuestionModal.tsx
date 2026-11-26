/**
 * QuestionModal —— 多选/单选问题交互弹窗（聚焦版）。
 *
 * 行为契约(从原 modals/index.tsx 抽出):
 *   - title 为 i18n `modal.question.title`。
 *   - 选项模式和回执遵循协议的 `multi_select` / `selected` 字段。
 *   - 每题支持可选的自定义答案。
 *   - 提交门控:每题都「选了选项或填了自定义」才可提交(未答完按钮
 *     置灰,Enter 同样被拦);显式跳过走关闭(Esc / 右上角 X),逐题
 *     发送空答案。
 */
import { useState } from 'react';
import { Input } from '@/features/harness/design-system';
import { useAgentStore, type PendingQuestion } from '@/stores/agentStore';
import type { Question } from '@/types/protocol';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from '@/render/harness/modals/index.module.css';

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

  // 提交门控:每题都答了(选选项或填自定义)才允许提交。空 questions 的
  // 请求 every 恒真 —— 保持可提交,空答案即可解锁引擎(与旧行为一致)。
  const allAnswered = items.every(
    (_, qIdx) => (selections[qIdx]?.length ?? 0) > 0 || Boolean(customAnswers[qIdx]?.trim()),
  );

  return (
    <ModalShell
      title={t('modal.question.title')}
      open={true}
      onClose={() => answerQuestion(question.id, { answers: items.map(() => ({ selected: [] })) })}
      primaryAction={{ label: t('modal.submit'), onClick: submit, autoFocus: false, disabled: !allAnswered }}
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
