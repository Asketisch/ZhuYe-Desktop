/**
 * useMessageListScroll —— 消息流滚动跟随测试。
 *
 * 覆盖四条规则:首次挂载落底、换会话强制回底、贴底跟随、用户上滚后让位
 * (并回滚后恢复)。
 *
 * jsdom 不做布局:scrollHeight / clientHeight 是只读属性,用
 * `Object.defineProperty` 摆成可写;scrollTop 是真实可写属性。
 * 尺寸在 ref 回调里摆 —— ref 先于 hook 的 layout effect 执行,挂载当拍
 * 就能看到正确尺寸。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useMessageListScroll } from '@/logic/webview/useMessageListScroll';
import type { Turn } from '@/stores/agent/types';

const TURN: Turn = { id: 't1', status: 'done', items: [] };
const TURN2: Turn = { id: 't2', status: 'done', items: [] };

/** 把尺寸摆到滚动节点上(jsdom 的 scrollHeight 只读)。 */
function setSize(el: HTMLElement, scrollHeight: number, clientHeight = 400) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, writable: true, configurable: true });
}

/** 取当前挂载的探针滚动节点。 */
function scroller(): HTMLDivElement {
  return document.querySelector('[data-testid="probe"]') as HTMLDivElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useMessageListScroll', () => {
  it('首次挂载(贴底意图初始为 true)直接落到底部', () => {
    function Probe() {
      const ref = useMessageListScroll([TURN], 's1');
      // ref 回调先于 layout effect → 挂载当拍尺寸已就位。
      return (
        <div
          ref={(el) => {
            ref.current = el;
            if (el) setSize(el, 2000);
          }}
          data-testid="probe"
        />
      );
    }
    render(<Probe />);
    expect(scroller().scrollTop).toBe(2000);
  });

  it('换会话(sessionKey 变化)强制回底,即使旧 scrollTop 停在顶部', () => {
    function Probe({ sessionKey }: { sessionKey: string }) {
      const ref = useMessageListScroll([TURN], sessionKey);
      return (
        <div
          ref={(el) => {
            ref.current = el;
            if (el && el.scrollTop === 0 && !el.dataset.sized) {
              el.dataset.sized = '1';
              setSize(el, 3000);
            }
          }}
          data-testid="probe"
        />
      );
    }
    const { rerender } = render(<Probe sessionKey="s1" />);
    const el = scroller();
    // 模拟旧会话留下的滚动位置(停在顶部)。
    el.scrollTop = 0;

    act(() => {
      rerender(<Probe sessionKey="s2" />);
    });
    expect(el.scrollTop).toBe(3000);
  });

  it('用户主动上滚后不再跟随(读历史不被拽回底部)', () => {
    function Probe({ turns }: { turns: readonly Turn[] }) {
      const ref = useMessageListScroll(turns, 's1');
      return (
        <div
          ref={(node) => {
            ref.current = node;
            if (node) setSize(node, 3000);
          }}
          data-testid="probe"
        />
      );
    }
    const { rerender } = render(<Probe turns={[TURN]} />);
    const el = scroller();

    // 用户上滚到 500(距底 2100 > 阈值 64)→ 让位。
    act(() => {
      el.scrollTop = 500;
      el.dispatchEvent(new Event('scroll'));
    });

    // 新内容到达(scrollHeight 变长)→ 不跟随。
    act(() => {
      setSize(el, 4000);
      rerender(<Probe turns={[TURN, TURN2]} />);
    });
    expect(el.scrollTop).toBe(500);
  });

  it('用户滚回底部附近后恢复跟随', () => {
    function Probe({ turns }: { turns: readonly Turn[] }) {
      const ref = useMessageListScroll(turns, 's1');
      return (
        <div
          ref={(node) => {
            ref.current = node;
            if (node && !node.dataset.sized) {
              node.dataset.sized = '1';
              setSize(node, 3000);
            }
          }}
          data-testid="probe"
        />
      );
    }
    const { rerender } = render(<Probe turns={[TURN]} />);
    const el = scroller();

    // 上滚 → 让位。
    act(() => {
      el.scrollTop = 300;
      el.dispatchEvent(new Event('scroll'));
    });
    // 滚回底部附近(距底 20 < 64)→ 恢复贴底意图。
    act(() => {
      el.scrollTop = 2580;
      el.dispatchEvent(new Event('scroll'));
    });
    // 内容长高 + 新回合到达 → 跟随到底。
    act(() => {
      setSize(el, 3500);
      rerender(<Probe turns={[TURN, TURN2]} />);
    });
    expect(el.scrollTop).toBe(3500);
  });
});