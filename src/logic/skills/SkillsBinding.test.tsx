import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsViewProps } from '@/contracts/knowledge/skills';
import { SkillsView } from '@/features/skills/SkillsView';
import { RendererProvider } from '@/logic/renderer/RendererProvider';
import { renderer } from '@/render';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

/** 捕获 Binding 传给视图的 props 的替代视图。 */
let captured: SkillsViewProps | null = null;
function ProbeView(props: SkillsViewProps) {
  captured = props;
  return <div data-testid="probe">probe</div>;
}

function renderSkills() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RendererProvider renderer={{ ...renderer, SkillsView: ProbeView }}>
        <SkillsView />
      </RendererProvider>
    </QueryClientProvider>,
  );
}

describe('SkillsBinding 市场', () => {
  it('搜索词 >= 2 才查询市场,短词与空词不触发', async () => {
    resetMockInvoke();
    const search = vi.fn(async (_cmd: string, _args: { query: string; limit: number }) => [
      { id: 'vercel-labs/skills/find-skills', source: 'vercel-labs/skills', slug: 'find-skills', official: true },
    ]);
    mockInvoke('zhuye_search_skill_market', search);
    mockInvoke('zhuye_list_skills', async () => []);
    mockInvoke('zhuye_list_tools', async () => []);
    renderSkills();
    await waitFor(() => expect(captured).not.toBeNull());

    // 短词:debounce 后 enabled=false,不发请求。直接驱动视图回调。
    captured!.onMarketQueryChange('x');
    await waitFor(() => expect(captured!.marketQuery).toBe('x'));
    expect(search).not.toHaveBeenCalled();

    // 长词:触发搜索。
    captured!.onMarketQueryChange('react');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });
    expect(search.mock.calls[0][1]).toMatchObject({ query: 'react' });
    await waitFor(() => expect(captured!.marketResults.length).toBe(1));
    expect(captured!.marketResults[0]).toMatchObject({
      id: 'vercel-labs/skills/find-skills',
      official: true,
    });
  });

  it('安装成功后通知后端命令并刷新技能列表,已装名集合来自列表', async () => {
    resetMockInvoke();
    const install = vi.fn(async (_cmd: string, _args: { source: string }) => 'sub-1');
    mockInvoke('zhuye_install_skill_from_market', install);
    mockInvoke('zhuye_list_skills', async () => [
      { name: 'already-here', path: '/.zhuye/skills/already-here/SKILL.md', description: '', tools: [], triggers: [], whenPaths: [] },
      { name: 'agents-skill', path: '/.agents/skills/agents-skill/SKILL.md', description: '', tools: [], triggers: [], whenPaths: [] },
    ]);
    mockInvoke('zhuye_search_skill_market', async () => [
      { id: 'a/b/already-here', source: 'a/b', slug: 'already-here', official: false },
    ]);
    mockInvoke('zhuye_list_tools', async () => []);
    renderSkills();
    await waitFor(() => expect(captured!.installedNames.has('already-here')).toBe(true));
    // .agents/skills 来源标签由 path 推断。
    expect(captured!.skills.find((s) => s.name === 'agents-skill')?.sourceLabel).toBe('agents');

    const entry = { id: 'a/b/new-one', source: 'a/b', slug: 'new-one', official: false };
    captured!.onMarketInstall(entry);
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(install.mock.calls[0][1]).toEqual({ source: 'a/b/new-one' });
  });

  it('刷新索引按钮调用刷新命令并回传条目数', async () => {
    resetMockInvoke();
    const refresh = vi.fn(async (_cmd: string) => 42);
    mockInvoke('zhuye_refresh_skill_market_index', refresh);
    mockInvoke('zhuye_list_skills', async () => []);
    mockInvoke('zhuye_list_tools', async () => []);
    renderSkills();
    await waitFor(() => expect(captured).not.toBeNull());
    captured!.onRefreshIndex();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
