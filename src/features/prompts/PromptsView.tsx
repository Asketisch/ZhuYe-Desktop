/**
 * Prompts —— 快捷 prompt 库（CSS Modules 版）。
 */
import { useState } from 'react';
import { BookOpen, Code2, FileCode, Bug, RefreshCw, Send, ChevronRight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Button, Icon } from '@/features/design-system';
import s from './PromptsView.module.css';

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  icon: ComponentType;
}

const PROMPTS: PromptTemplate[] = [
  {
    id: 'review',
    name: 'Review code',
    description: '审查当前工作区的代码(找 bug / 安全 / 风格)',
    body: '请审查当前工作区的代码,关注:潜在的 bug、安全问题、风格一致性。先列出你审查的文件,再给出具体建议。',
    icon: FileCode,
  },
  {
    id: 'tests',
    name: 'Write tests',
    description: '为最近修改的代码补单元测试',
    body: '请先用 git diff 查看最近修改,然后为修改的函数补充单元测试。运行测试确认通过。',
    icon: Bug,
  },
  {
    id: 'explain',
    name: 'Explain architecture',
    description: '解释当前项目的架构',
    body: '请阅读项目根目录的关键文件(README、Cargo.toml/package.json、入口),用简洁的中文解释这个项目的架构和模块职责。',
    icon: BookOpen,
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: '重构指定代码以提升可读性',
    body: '我想重构代码以提升可读性和可维护性。请先问我具体想重构哪个文件或模块,然后给出重构方案。',
    icon: RefreshCw,
  },
  {
    id: 'debug',
    name: 'Debug error',
    description: '帮我调试一个错误',
    body: '我遇到了一个错误。请先问我错误信息和复现步骤,然后帮我定位根因并修复。',
    icon: Bug,
  },
  {
    id: 'plan',
    name: 'Plan a feature',
    description: '进入 plan 模式规划一个新功能',
    body: '我想实现一个新功能。请进入 plan 模式,先了解需求,再给出实现计划供我审批。',
    icon: Code2,
  },
];

export function PromptsView() {
  const submit = useAgentStore((st) => st.submit);
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async (p: PromptTemplate) => {
    await submit(p.body);
    setSent(p.id);
    setTimeout(() => setSent(null), 2000);
  };

  return (
    <PageShell
      icon={BookOpen}
      title="Prompts"
      subtitle="Send a template to the current chat. Custom prompts from ~/.zhuye/prompts/ coming later."
      width="md"
    >
      <div className={s.list}>
        {PROMPTS.map((p) => {
          const isOpen = selected === p.id;
          return (
            <Card key={p.id} level="outlined" padding="none" className={s.item} data-open={isOpen || undefined}>
              <button className={s.itemHeader} onClick={() => setSelected(isOpen ? null : p.id)}>
                <div className={s.itemIcon}>
                  <Icon icon={p.icon} size={16} />
                </div>
                <div className={s.itemBody}>
                  <div className={s.itemName}>{p.name}</div>
                  <div className={s.itemDesc}>{p.description}</div>
                </div>
                <Icon icon={ChevronRight} size={14} className={s.chevron} />
              </button>
              {isOpen && (
                <div className={s.itemDetail}>
                  <pre className={s.bodyPre}>{p.body}</pre>
                  <Button
                    variant={sent === p.id ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => send(p)}
                    leftIcon={<Icon icon={Send} size={13} />}
                  >
                    {sent === p.id ? 'Sent ✓' : 'Send to chat'}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
