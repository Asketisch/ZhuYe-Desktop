import { useState } from 'react';
import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { PromptTemplateView, PromptsViewProps } from '@/contracts/knowledge/prompts';

const PROMPTS: PromptTemplateView[] = [
  { id: 'review', name: 'Review code', description: '审查当前工作区的代码(找 bug / 安全 / 风格)', body: '请审查当前工作区的代码,关注:潜在的 bug、安全问题、风格一致性。先列出你审查的文件,再给出具体建议。' },
  { id: 'tests', name: 'Write tests', description: '为最近修改的代码补单元测试', body: '请先用 git diff 查看最近修改,然后为修改的函数补充单元测试。运行测试确认通过。' },
  { id: 'explain', name: 'Explain architecture', description: '解释当前项目的架构', body: '请阅读项目根目录的关键文件(README、Cargo.toml/package.json、入口),用简洁的中文解释这个项目的架构和模块职责。' },
  { id: 'refactor', name: 'Refactor', description: '重构指定代码以提升可读性', body: '我想重构代码以提升可读性和可维护性。请先问我具体想重构哪个文件或模块,然后给出重构方案。' },
  { id: 'debug', name: 'Debug error', description: '帮我调试一个错误', body: '我遇到了一个错误。请先问我错误信息和复现步骤,然后帮我定位根因并修复。' },
  { id: 'plan', name: 'Plan a feature', description: '进入 plan 模式规划一个新功能', body: '我想实现一个新功能。请进入 plan 模式,先了解需求,再给出实现计划供我审批。' },
];

/** 快捷 prompt 库绑定。 */
export function PromptsBinding({ view: View }: { view: ComponentType<PromptsViewProps> }) {
  const submit = useAgentStore((st) => st.submit);
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = (id: string) => {
    const prompt = PROMPTS.find((p) => p.id === id);
    if (!prompt) return;
    void submit(prompt.body)
      .then(() => setSent(id))
      .finally(() => setTimeout(() => setSent((prev) => (prev === id ? null : prev)), 2000));
  };

  return (
    <View
      t={(key) => key}
      prompts={PROMPTS}
      selectedId={selected}
      sentId={sent}
      onToggle={(id) => setSelected((prev) => (prev === id ? null : id))}
      onSend={send}
    />
  );
}
