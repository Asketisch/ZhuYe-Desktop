/**
 * Vitest — threads 工具测试。
 */
import { describe, it, expect } from 'vitest';
import { chatLinkFor, shortTimestamp } from '@/logic/conversation/threads/utils/threadLabels';

describe('chatLinkFor', () => {
  it('builds /chat/<id>', () => {
    expect(chatLinkFor({ session_id: 'abc123' })).toBe('/chat/abc123');
  });

  it('handles uuid-shaped ids', () => {
    expect(chatLinkFor({ session_id: '11111111-2222-3333-4444-555555555555' }))
      .toBe('/chat/11111111-2222-3333-4444-555555555555');
  });
});

describe('shortTimestamp', () => {
  it('formats ISO string', () => {
    const out = shortTimestamp('2026-07-08T12:34:56Z');
    // 不断言精确文本（依赖 locale）；仅断言非空
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns empty for invalid input', () => {
    expect(shortTimestamp('not-a-date')).toBe('');
  });
});