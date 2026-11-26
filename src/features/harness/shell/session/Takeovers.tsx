/**
 * Takeovers —— 审批 / 提问 / 输入 的 composer 座位接管卡(v2-shell-redesign)。
 *
 * DeepSeek ui-approval / ui-user-questions 口径:等待交互时**接管 composer
 * 本体**(composer 整体隐藏,不留占位卡),处理完成后交还。
 * 数据与动作全部来自既有 store(pendingApprovals / pendingQuestions /
 * pendingAskUser + approve / answerQuestion / answerInput),不新增 IPC。
 * 全局 ModalStack 会因 `suppressInteractionModals` 跳过同源 modal,避免双 UI。
 */
import { useState } from 'react';
import { Shield, X, Check, Loader2 } from 'lucide-react';
import { useAgentStore, type PendingApproval, type PendingQuestion, type PendingAskUser } from '@/stores/agentStore';
import type { Question } from '@/types/protocol';
import { useI18n } from '@/utils/i18n';
import s from '@/render/harness/shell/session/session.module.css';

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
    ? t('approval.title', { tool: approval.toolName ?? 'bash' })
    : t('approval.hookTitle');

  return (
    <div className={s.takeover} data-kind="approval" data-testid="session-approval">
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
          data-testid="session-approval-deny"
          onClick={() => decide({ deny: { reason: 'denied by user' } })}
        >
          {t('approval.deny')}
        </button>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto' }}
          disabled={busy}
          data-testid="session-approval-session"
          onClick={() => decide('approve_for_session')}
        >
          {t('approval.session')}
        </button>
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 }}
          disabled={busy}
          autoFocus
          data-testid="session-approval-allow"
          onClick={() => decide('approve')}
        >
          {t('approval.once')}
        </button>
        <span className={s.tkNote}>{t('approval.alwaysHint')}</span>
      </div>
    </div>
  );
}

/* ===== 多选/单选问题(协议 questions[])=====
 * v1.13:**一道题一个页签**,一次只呈现一道(原先全部堆叠,三题就能把
 * composer 座位撑成一整屏,选项要滚好几屏才够到提交)。答案仍按题号
 * 存在 `selections` / `custom` 里,切页签不丢;提交一次性回传 answers[],
 * 未作答的题给空选择(与「跳过」同语义)。 */
export function QuestionTakeover({ question }: { question: PendingQuestion }) {
  const { t } = useI18n();
  const answerQuestion = useAgentStore((st) => st.answerQuestion);
  const payload = question.payload as { questions?: Question[] };
  const items = payload?.questions ?? [];
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const multi = items.length > 1;
  const active = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);

  const toggle = (qIdx: number, optIdx: number, isMulti: boolean) => {
    setSelections((prev) => {
      const cur = prev[qIdx] ?? [];
      if (isMulti) {
        return { ...prev, [qIdx]: cur.includes(optIdx) ? cur.filter((i) => i !== optIdx) : [...cur, optIdx] };
      }
      return { ...prev, [qIdx]: [optIdx] };
    });
  };

  /** 该题是否已答(选了选项或填了自定义)。 */
  const answered = (qi: number) =>
    (selections[qi]?.length ?? 0) > 0 || Boolean(custom[qi]?.trim());

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

  const tabLabel = (item: Question, qi: number) =>
    item.header?.trim() || t('modal.question.fallback', { n: String(qi + 1) });

  const item = items[active];

  return (
    <div className={s.takeover} data-kind="question" data-testid="session-question">
      <div className={s.tkHead} style={{ color: 'var(--info)' }}>
        {t('modal.question.title')}
        {multi && (
          <span className={s.tkNote} data-testid="question-progress">
            {t('modal.question.progress', { current: String(active + 1), total: String(items.length) })}
          </span>
        )}
      </div>

      {/* 页签条:一题一页签,已答的打勾(切走也知道哪题还没答)。 */}
      {multi && (
        <div className={s.qTabs} role="tablist" aria-label={t('modal.question.tabsAria')} data-testid="question-tabs">
          {items.map((it, qi) => (
            <button
              key={qi}
              type="button"
              role="tab"
              aria-selected={qi === active}
              className={s.qTab}
              data-active={qi === active || undefined}
              data-answered={answered(qi) || undefined}
              data-testid={`question-tab-${qi}`}
              onClick={() => setActiveIdx(qi)}
            >
              {answered(qi) && <Check size={11} aria-label={t('modal.question.answered')} />}
              <span className={s.qTabTxt}>{tabLabel(it, qi)}</span>
            </button>
          ))}
        </div>
      )}

      {items.length === 0 && <div className={s.tkQtext}>{t('modal.question.empty')}</div>}

      {item && (
        <div role="tabpanel" data-testid={`question-panel-${active}`}>
          <div className={s.tkQtext}>{item.question ?? item.header ?? `#${active + 1}`}</div>
          {(item.options ?? []).map((opt, optIdx) => {
            const sel = (selections[active] ?? []).includes(optIdx);
            const label = opt.label ?? String(opt);
            return (
              <button
                key={optIdx}
                type="button"
                className={s.tkOpt}
                data-sel={sel}
                onClick={() => toggle(active, optIdx, item.multi_select ?? false)}
              >
                <span className={s.zyTbox ?? ''} style={{ borderRadius: '50%', marginTop: 2 }} data-sel={sel}>
                  {sel ? <Check size={10} /> : ''}
                </span>
                {label}
                {opt.description ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>— {opt.description}</span> : null}
              </button>
            );
          })}
          <input
            value={custom[active] ?? ''}
            onChange={(e) => setCustom((prev) => ({ ...prev, [active]: e.target.value }))}
            placeholder={t('modal.question.custom')}
            aria-label={`Other (optional) — ${item.question ?? item.header ?? ''}`}
            className={s.urlInput}
            style={{ width: '100%', height: 30, marginBottom: 4 }}
          />
        </div>
      )}

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
        {multi && (
          <>
            <button
              type="button"
              className={s.popRow}
              style={{ width: 'auto' }}
              disabled={active === 0}
              data-testid="question-prev"
              onClick={() => setActiveIdx(Math.max(0, active - 1))}
            >
              {t('modal.question.prev')}
            </button>
            <button
              type="button"
              className={s.popRow}
              style={{ width: 'auto' }}
              disabled={active >= items.length - 1}
              data-testid="question-next"
              onClick={() => setActiveIdx(Math.min(items.length - 1, active + 1))}
            >
              {t('modal.question.next')}
            </button>
          </>
        )}
        <button
          type="button"
          className={s.popRow}
          style={{ width: 'auto', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 }}
          disabled={busy}
          autoFocus
          data-testid="question-submit"
          onClick={submit}
        >
          {busy ? <Loader2 size={13} /> : <Check size={13} />} {t('modal.submit')}
        </button>
      </div>
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
    <div className={s.takeover} data-kind="question" data-testid="session-askuser">
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
