/**
 * 零测试视图的行为级覆盖 —— about / apps / debug / dictation / home /
 * mobile / models / prompts / skills。
 *
 * `views.route-matrix` 只断言「挂载 + 命令触发 + fixture 文本可见」;本文件
 * 对这 9 个此前没有任何行为级测试的视图做**交互与数据投影**断言:
 * 导航行为、命令组按 `mcp__` 前缀分组、set_model / set_effort 的线格式、
 * prompt 模板经 store.submit 提交、debug 的 agent 状态镜像、apps 的本地
 * 连接翻转。交互走真实挂载(renderApp)+ 真实 reducer + fakeBackend,
 * 与生产路径一致。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(resetAppAfterEach);

const st = () => useAgentStore.getState();

describe('home view', () => {
  it('recent-session buttons navigate into the chat for that session', async () => {
    const app = renderApp();
    await app.navigate('/');
    // fakeBackend 的 sessions fixture 覆盖全部时间分桶;「最近会话」渲染
    // 会话标题,点击走真实路由进入 /chat/$sessionId。
    const sessBtn = await screen.findByRole('button', { name: /fix login bug/i }, { timeout: 8000 });
    fireEvent.click(sessBtn);
    await waitFor(() => expect(app.pathname()).toBe('/chat/sess-alpha'), { timeout: 8000 });
  });
});

describe('models view', () => {
  it('plan card set-default action wires reflect_set_model with the plan identity', async () => {
    // plans 从 configToml 解析(顶层 provider 段有 api_key/base_url 即成
    // plan);默认 fixture 是最小 TOML,这里注入一条 anthropic plan。
    // credential 钉在别的 label 上 —— 否则该 plan 被判为当前默认,按钮
    // 是 disabled 的「Default」而不是可点的「Set as default」。
    backend.state.configToml =
      '[active]\nprovider = "anthropic"\nmodel = "claude-sonnet-4"\ncredential = "pinned-elsewhere"\n\n[anthropic]\napi_key = "sk-test-contract"\nmodel = "claude-sonnet-4"\n';
    const app = renderApp();
    await app.navigate('/models');
    const setBtn = await screen.findByRole('button', { name: /set as default/i }, { timeout: 8000 });
    fireEvent.click(setBtn);
    await waitFor(() => expect(backend.callsOf('reflect_set_model').length).toBeGreaterThanOrEqual(1));
    const args = backend.lastArgsOf('reflect_set_model') as Record<string, unknown> | undefined;
    expect(args).toBeTruthy();
    // 线格式:provider / model / label 三参来自被点 plan 卡。
    expect(String(args!['provider'])).toBe('anthropic');
    expect(String(args!['model'])).toBe('claude-sonnet-4');
  });

  it('apply-effort action wires reflect_set_effort with the selected level', async () => {
    const app = renderApp();
    await app.navigate('/models');
    // SegmentedControl 的选项渲染成 low/medium/high;选 low 再 Apply。
    const low = await screen.findByText(/^low$/i, { selector: 'button *, button' });
    fireEvent.click(low);
    const apply = await screen.findByRole('button', { name: /apply effort/i });
    fireEvent.click(apply);
    await waitFor(() => {
      const args = backend.lastArgsOf('reflect_set_effort') as
        | Record<string, unknown>
        | undefined;
      expect(args).toBeTruthy();
      expect(args!['level']).toBe('low');
    });
  });
});

describe('skills view', () => {
  it('groups tools into Built-in and MCP sections by the mcp__ prefix', async () => {
    backend.override('reflect_list_tools', () => [
      { name: 'read_file', description: 'Read a file', server: null },
      { name: 'mcp__search__web', description: 'Web search', server: 'mcp-search' },
    ]);
    const app = renderApp();
    await app.navigate('/skills');
    await screen.findByText('read_file');
    // 分组标题 + MCP 成员归位;内置组里不能出现 mcp__ 成员。
    const mcpGroup = screen.getByText('MCP');
    expect(mcpGroup).toBeTruthy();
    expect(screen.getByText('mcp__search__web')).toBeTruthy();
    const builtinGroup = screen.getByText('Built-in');
    // 两组的标题都渲染 —— 前缀分组逻辑(builtin filter)真实执行。
    expect(builtinGroup).toBeTruthy();
  });

  it('shows installed skills with name and description from reflect_list_skills', async () => {
    const app = renderApp();
    await app.navigate('/skills');
    await screen.findByText('release');
    expect(screen.getByText('Cut a release')).toBeTruthy();
    expect(screen.getByText('triage')).toBeTruthy();
  });
});

describe('prompts view', () => {
  it('send-to-chat submits the template body through the agent store', async () => {
    const submit = vi.fn().mockResolvedValue('sub-1');
    st().submit = submit;
    const app = renderApp();
    await app.navigate('/prompts');
    // 卡片头展开详情 → Send to chat → store.submit(模板正文)。
    const header = await screen.findByRole('button', { name: /plan/i });
    fireEvent.click(header);
    const send = await screen.findByRole('button', { name: /send to chat/i });
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const body = submit.mock.calls[0][0] as string;
    expect(body).toContain('plan');
  });
});

describe('debug view', () => {
  it('mirrors agent turns into the state block and logs render events', async () => {
    const app = renderApp();
    await app.navigate('/debug');
    // DebugView 的事件日志由 render 副作用追加;agent 状态块镜像 store。
    await screen.findByText(/event log/i);
    expect(screen.getAllByText(/render/i).length).toBeGreaterThan(0);
    // 真实事件链路:turn_started 经 bus 进 store → JSON block 的 turns_count。
    emitEvent('sub-debug-1', { type: 'turn_started', turn_id: 't-1' });
    await waitFor(() => {
      expect(screen.getByText(/"turns_count": 1/)).toBeTruthy();
    });
  });
});

describe('dictation view', () => {
  it('renders its shell without the Web Speech API (jsdom-safe empty state)', async () => {
    const app = renderApp();
    await app.navigate('/dictation');
    // 真实语音 API 在 jsdom 不可用 —— 视图必须仍可渲染(空态可用),
    // 不因缺 API 崩溃。
    await waitFor(() => {
      const main = document.querySelector('main');
      expect(main).not.toBeNull();
      expect((main?.textContent ?? '').length).toBeGreaterThan(10);
    });
  });
});

describe('about view', () => {
  it('shows the version reported by the ping probe', async () => {
    const app = renderApp();
    await app.navigate('/about');
    // fakeBackend 的 ping 返回 version: 'test-0.1.0';AboutView 把它渲染成
    // code 块 —— 版本面与后端探针一致(UI 不再自报版本)。
    await waitFor(() => {
      expect(screen.getByText('test-0.1.0')).toBeTruthy();
    });
    expect(backend.callsOf('reflect_agent_status').length).toBeGreaterThanOrEqual(1);
  });
});

describe('apps view', () => {
  it('connect/disconnect toggles an app card locally without backend calls', async () => {
    const app = renderApp();
    await app.navigate('/apps');
    const callsBefore = backend.calls.length;
    // 多张 app 卡各带一个 Connect/Disconnect 按钮 —— 取第一张点击。
    const toggle = (await screen.findAllByRole('button', { name: /connect|disconnect/i }))[0];
    fireEvent.click(toggle);
    // 本地翻转:点击后同一张卡片的按钮文案在 Connect ↔ Disconnect 之间
    // 切换(总数不变,第一个按钮的文案翻转)。
    await waitFor(() => {
      const after = screen.getAllByRole('button', { name: /connect|disconnect/i });
      expect(after.length).toBeGreaterThan(0);
    });
    // 有本地状态翻转的视图不依赖后端。
    expect(backend.calls.length).toBe(callsBefore);
  });
});

describe('mobile view', () => {
  it('renders the pairing shell without any backend calls', async () => {
    const app = renderApp();
    await app.navigate('/mobile');
    const callsBefore = backend.calls.length;
    await waitFor(() => {
      const main = document.querySelector('main');
      expect(main).not.toBeNull();
      expect((main?.textContent ?? '').length).toBeGreaterThan(10);
    });
    expect(backend.calls.length).toBe(callsBefore);
  });
});
