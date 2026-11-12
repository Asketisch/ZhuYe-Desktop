/**
 * AskUserModal —— 自由文本输入弹窗（聚焦版）。
 *
 * 行为契约(从原 modals/index.tsx 抽出,不可变):
 *   - title 为 i18n `modal.askUser.title`。
 *   - 内容渲染 prompt(默认 fallback)+ textarea(autoFocus)。
 *   - primary 为 Submit(autoFocus=false),onClose 提交空字符串。
 *   - 提交把 textarea 当前值走 store `answerInput`。
 */
import { useState } from 'react';
import { Input } from '@/features/design-system';
import { useAgentStore, type PendingAskUser } from '@/stores/agentStore';
import type { AskUserInputPayload } from '@/types/protocol';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from './index.module.css';

export function AskUserModal({ askUser }: { askUser: PendingAskUser }) {
  const { t } = useI18n();
  const answerInput = useAgentStore((st) => st.answerInput);
  const payload = askUser.payload as Partial<AskUserInputPayload>;
  const [text, setText] = useState('');
  const prompt = payload?.prompt ?? t('modal.askUser.defaultPrompt');
  const placeholder = payload?.placeholder ?? t('modal.askUser.placeholder');
  return (
    <ModalShell
      title={t('modal.askUser.title')}
      open={true}
      onClose={() => answerInput(askUser.id, '')}
      primaryAction={{ label: t('modal.submit'), onClick: () => answerInput(askUser.id, text), autoFocus: false }}
    >
      <p className={s.promptText}>{prompt}</p>
      {payload?.secret ? (
        <Input
          type="password"
          aria-label={prompt}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className={s.textarea}
          autoFocus
        />
      )}
    </ModalShell>
  );
}
