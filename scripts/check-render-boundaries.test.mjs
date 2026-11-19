import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { checkSource } from './check-render-boundaries.mjs';

const render = resolve('src/render/example/View.tsx');
const logic = resolve('src/logic/example/controller.ts');

test('允许视图使用类型契约和同层样式', () => {
  assert.deepEqual(checkSource(render, "import type { TerminalViewProps } from '@/contracts/terminal'; import './view.css'; export const View = (p: TerminalViewProps) => <div>{p.state.input}</div>;"), []);
});

test('拒绝渲染层依赖逻辑、宿主和状态', () => {
  for (const code of [
    "import { useState as state } from 'react';",
    "import { useAgentStore } from '@/stores/agent';",
    "export * from '../../logic/example/controller';",
    "const get = () => import('@/logic/example/controller');",
    "const get = (p: string) => import(p);",
    "React.useEffect(() => {}, []);",
    "window.localStorage.clear();",
  ]) assert.ok(checkSource(render, code).length > 0, code);
});

test('拒绝逻辑层依赖渲染或样式', () => {
  for (const code of [
    "import View from '@/render/example/View';",
    "import { confirmDialog } from '@/features/modals/ConfirmDialog';",
    "import { getTheme } from '@/utils/theme';",
    "export * from '../../render/example/View';",
    "import('./view.css');",
    "import { Square } from 'lucide-react';",
  ]) assert.ok(checkSource(logic, code).length > 0, code);
});
