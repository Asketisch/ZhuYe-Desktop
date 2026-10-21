/**
 * TeamEditor —— 团队建 / 改 / 删的渲染与载荷测试。
 *
 * 验证：
 *   - 列表渲染已有团队 + 成员数
 *   - 新建:名字非法 → 本地报错,不发请求
 *   - 新建:合法 → 发出的 team 载荷满足核心规则
 *     (name 合法 + lead_agent_id === "team-lead@<name>" + SystemTime 形态)
 *   - 编辑:保留原始 created_at / joined_at
 *   - 删除:调用 delete_team
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TeamEditor } from './TeamEditor';
import type { ReflectTeam } from '@/utils/commands';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

const NOW = { secs_since_epoch: 1_700_000_000, nanos_since_epoch: 0 };

const EXISTING: ReflectTeam = {
  name: 'rocket',
  description: 'ship it',
  lead_agent_id: 'team-lead@rocket',
  lead_session_id: null,
  members: [
    {
      agent_id: 'architect@rocket',
      name: 'architect',
      role: 'architect',
      model: null,
      system_prompt: 'design things',
      allowed_tools: [],
      color: null,
      joined_at: NOW,
      session_id: null,
      subscriptions: [],
    },
  ],
  created_at: NOW,
};

describe('TeamEditor', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('列出已有团队与成员数', () => {
    render(<TeamEditor teams={[EXISTING]} onSave={vi.fn()} onDelete={vi.fn()} />);
    const item = screen.getByTestId('team-item-rocket');
    expect(item.textContent).toContain('rocket');
    expect(item.textContent).toContain('ship it');
    expect(item.textContent).toContain('1');
  });

  it('名字非法 → 本地报错,不发请求', async () => {
    const onSave = vi.fn();
    render(<TeamEditor teams={[]} onSave={onSave} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('team-create-btn'));
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: 'Bad Name!' } });
    fireEvent.click(screen.getByTestId('team-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeDefined();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('新建 → 载荷满足核心规则(lead_agent_id 推导 + SystemTime 形态)', async () => {
    const onSave = vi.fn(async (_team: ReflectTeam) => {});
    render(<TeamEditor teams={[]} onSave={onSave} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('team-create-btn'));
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: 'squad-a' } });
    fireEvent.change(screen.getByTestId('team-description-input'), { target: { value: 'a team' } });
    fireEvent.click(screen.getByTestId('team-add-member'));
    fireEvent.change(screen.getByTestId('team-member-role'), { target: { value: 'builder' } });
    fireEvent.change(screen.getByTestId('team-member-prompt'), { target: { value: 'write code' } });
    fireEvent.click(screen.getByTestId('team-save-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const team = onSave.mock.calls[0][0] as ReflectTeam;
    expect(team.name).toBe('squad-a');
    expect(team.lead_agent_id).toBe('team-lead@squad-a');
    expect(team.description).toBe('a team');
    expect(team.members).toHaveLength(1);
    expect(team.members[0].agent_id).toBe('builder@squad-a');
    expect(team.members[0].system_prompt).toBe('write code');
    // 时间字段是核心 SystemTime 的 JSON 形态(不是数字)。
    expect(typeof team.created_at).toBe('object');
    expect(team.created_at.secs_since_epoch).toBeGreaterThan(0);
    expect(typeof team.members[0].joined_at).toBe('object');
  });

  it('编辑 → 保留原始 created_at / joined_at', async () => {
    const onSave = vi.fn(async (_team: ReflectTeam) => {});
    render(<TeamEditor teams={[EXISTING]} onSave={onSave} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('team-edit-rocket'));
    fireEvent.change(screen.getByTestId('team-description-input'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByTestId('team-save-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const team = onSave.mock.calls[0][0] as ReflectTeam;
    expect(team.description).toBe('updated');
    expect(team.created_at).toEqual(NOW);
    expect(team.members[0].joined_at).toEqual(NOW);
  });

  it('删除 → 调用 onDelete(name)', async () => {
    const onDelete = vi.fn(async () => {});
    render(<TeamEditor teams={[EXISTING]} onSave={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('team-delete-rocket'));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('rocket');
    });
  });
});
