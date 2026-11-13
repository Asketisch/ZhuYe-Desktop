/**
 * Takeovers —— 审批 / 提问 / 输入 的 composer 座位接管卡(redesign/zcode-shell)。
 *
 * DeepSeek ui-approval / ui-user-questions 口径:等待交互时**接管 composer
 * 本体**(composer 整体隐藏,不留占位卡),处理完成后交还。
 * 数据与动作全部来自既有 store(pendingApprovals / pendingQuestions /
 * pendingAskUser + approve / answerQuestion / answerInput),不新增 IPC。
 * 全局 ModalStack 会因 `suppressInteractionModals` 跳过同源 modal,避免双 UI。
 */
import { useState } from 'react';
import { Shield, X, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAgentStore, type PendingApproval, type PendingQuestion, type PendingAskUser } from '@/stores/agentStore';
import type { Question } from '@/types/protocol';
import { useI18n } from '@/utils/i18n';
import s from './zcode.module.css';

/* ===== 工具 / Hook 审批 ===== */
export function ApprovalTakeover({ approval }: { approval: PendingApproval }) {
  const { t } = useI18n();
  const approve = useAgentStore((st) => st.approve);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: Parameters<typeof approve>[2]) => {
    setBusy(true);
    setError(null);
    approve(approval.kind, approval.id, decision)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const title = approval.kind === 'tool'
    ? t('zcode.approval.title', { tool: approval.toolName ?? 'bash' })
    : t('zcode.approval.hookTitle');

  return (
    <div className={s.takeover} data-kind="approval" data-testid="zcode-approval">
      <div className={s.tkHead}>
        <Shield size={14} />
        {title}
      </div>
      {approval.argsSummary && <div className={s.tkCmd}>{approval.argsSummary}</div>}
      {error && <div className={s.tkQtext} style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className={s.tkRow}>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto', color: 'var(--danger)' }}
          disabled={busy}
          data-testid="zcode-approval-deny"
          onClick={() => decide({ deny: { reason: 'denied by user' } })}
        >
          {t('zcode.approval.deny')}
        </button>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto' }}
          disabled={busy}
          data-testid="zcode-approval-session"
          onClick={() => decide('approve_for_session')}
        >
          {t('zcode.approval.session')}
        </button>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 }}
          disabled={busy}
          autoFocus
          data-testid="zcode-approval-allow"
          onClick={() => decide('approve')}
        >
          {t('zcode.approval.once')}
        </button>
        <span className={s.tkNote}>{t('zcode.approval.alwaysHint')}</span>
      </div>
    </div>
  );
}

/* ===== 多选/单选问题(协议 questions[])===== */
export function QuestionTakeover({ question }: { question: PendingQuestion }) {
  const { t } = useI18n();
  const answerQuestion = useAgentStore((st) => st.answerQuestion);
  const payload = question.payload as { questions?: Question[] };
  const items = payload?.questions ?? [];
  const [idx, setIdx] = useState(0);
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const qIdx = Math.min(idx, Math.max(0, items.length - 1));
  const item = items[qIdx];
  const multi = item?.multi_select ?? false;

  const toggle = (optIdx: number) => {
    setSelections((prev) => {
      const cur = prev[qIdx] ?? [];
      if (multi) {
        return { ...prev, [qIdx]: cur.includes(optIdx) ? cur.filter((i) => i !== optIdx) : [...cur, optIdx] };
      }
      return { ...prev, [qIdx]: [optIdx] };
    });
  };

  const submit = () => {
    setBusy(true);
    const answers = items.map((_, qi) => ({
      selected: selections[qi] ?? [],
      ...(custom[qi]?.trim() ? { custom: custom[qi].trim() } : {}),
    }));
    answerQuestion(question.id, { answers })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className={s.takeover} data-kind="question" data-testid="zcode-question">
      <div className={s.tkHead} style={{ color: 'var(--info)' }}>
        {items.length > 1 && (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <button type="button" className={s.popRow} style={{ width: 'auto', padding: '2px 4px' }} aria-label={t('modal.prev')} disabled={qIdx === 0} onClick={() => setIdx((v) => Math.max(0, v - 1))}>
              <ChevronLeft size={12} />
            </button>
            <span style={{ fontVariantNumeric: 'tabular-nums', alignSelf: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {qIdx + 1} / {items.length}
            </span>
            <button type="button" className={s.popRow} style={{ width: 'auto', padding: '2px 4px' }} aria-label={t('modal.next')} disabled={qIdx >= items.length - 1} onClick={() => setIdx((v) => Math.min(items.length - 1, v + 1))}>
              <ChevronRight size={12} />
            </button>
          </span>
        )}
      </div>
      {item ? (
        <>
          <div className={s.tkQtext}>{item.question ?? item.header ?? `#${qIdx + 1}`}</div>
          <div>
            {(item.options ?? []).map((opt, optIdx) => {
              const sel = (selections[qIdx] ?? []).includes(optIdx);
              return (
                <button
                  key={optIdx}
                  type="button"
                  className={s.tkOpt}
                  data-sel={sel}
                  onClick={() => toggle(optIdx)}
                >
                  <span className={s.zyTbox ?? ''} style={{ borderRadius: '50%', marginTop: 2 }} data-sel={sel}>
                    {sel ? <Check size={10} /> : ''}
                  </span>
                  {opt.label ?? String(opt)}
                </button>
              );
            })}
            <input
              value={custom[qIdx] ?? ''}
              onChange={(e) => setCustom((prev) => ({ ...prev, [qIdx]: e.target.value }))}
              placeholder={t('modal.question.custom')}
              className={s.urlInput}
              style={{ width: '100%', height: 30, marginBottom: 4 }}
              aria-label={t('modal.question.custom')}
            />
          </div>
          <div className={s.tkRow}>
            <button
              type="button"
              className={s.popRow}
              style={{ width: 'auto' }}
              disabled={busy}
              onClick={() => { setBusy(true); answerQuestion(question.id, { answers: items.map(() => ({ selected: [] })) }).catch(() => undefined).finally(() => setBusy(false)); }}
            >
              {t('modal.skip')}
            </button>
            <button
              type="button"
              className={s.popRow}
              style={{ width: 'auto', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 }}
              disabled={busy}
              autoFocus
              onClick={submit}
            >
              {busy ? <Loader2 size={13} /> : <Check size={13} />} {t('modal.submit')}
            </button>
          </div>
        </>
      ) : (
        <div className={s.tkQtext}>{t('modal.question.empty')}</div>
      )}
    </div>
  );
}

/* ===== 自由文本输入 ===== */
export function AskUserTakeover({ askUser }: { askUser: PendingAskUser }) {
  const { t } = useI18n();
  const answerInput = useAgentStore((st) => st.answerInput);
  const payload = askUser.payload as { prompt?: string; placeholder?: string } | null;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const prompt = payload?.prompt ?? t('modal.askUser.defaultPrompt');
  return (
    <div className={s.takeover} data-kind="question" data-testid="zcode-askuser">
      <div className={s.tkHead} style={{ color: 'var(--info)' }}>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text-primary)' }}>{prompt}</span>
        <button
          type="button"
          className={s.tiClose}
          aria-label={t('modal.skip')}
          title={t('modal.skip')}
          onClick={() => answerInput(askUser.id, '')}
        >
          <X size={13} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={payload?.placeholder ?? t('modal.askUser.placeholder')}
        className={s.urlInput}
        style={{ width: '100%', minHeight: 60, marginBottom: 6, padding: 'var(--space-2)', resize: 'vertical', color: 'var(--text-primary)' }}
        autoFocus
      />
      <div className={s.tkRow}>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 }}
          disabled={busy}
          onClick={() => { setBusy(true); answerInput(askUser.id, text).catch(() => undefined).finally(() => setBusy(false)); }}
        >
          {busy ? <Loader2 size={13} /> : <Check size={13} />} {t('modal.submit')}
        </button>
      </div>
    </div>
  );
}
