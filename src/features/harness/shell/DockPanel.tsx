/**
 * DockPanel —— 右 dock 标签页内容调度器（ZCode side-pane 同款）。
 *
 * 按 `dockTabs` 顺序渲染全部标签页内容，非激活标签用 `hidden` 保活
 * （切来切去不丢状态：文件树展开、浏览器导航、用量轮询等）。
 * 需要轮询/帧流的面板（浏览器、用量）通过 `active` 属性在非激活时暂停。
 *
 * - inspector：检查器（概览 / 文件 / 改动 / Git）
 * - review：工作区 git diff（复用 Inspector 的 ChangesTab）
 * - files：文件树 + 代码预览
 * - browser：受控浏览器（CDP screencast + 导航栏）
 * - agents：子代理记录
 * - usage：用量面板
 * - plan：计划文档 + 审批（PlanDock，可滚动、可提交执行）
 * - new-tab：启动器（DockLauncher）
 */
import type { DockTab } from '@/contracts/harness/shell';
import { Inspector, ChangesTab } from './Inspector';
import { BrowserDock } from '@/features/workbench/browser/BrowserDock';
import { FilesDock } from '@/features/workbench/files/FilesDock';
import { AgentsDock } from '@/features/orchestration/agents/AgentsDock';
import { UsageDock } from '@/features/telemetry/usage/UsageDock';
import { PlanDock } from './PlanDock';
import { DockLauncher } from '@/render/harness/shell/DockLauncher';
import { useI18n } from '@/utils/i18n';
import { useShellUi } from '@/stores/shellUi';
import { useAgentStore } from '@/stores/agentStore';

function TabPane({ tab, active, children }: {
  tab: DockTab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="dock-pane"
      hidden={!active}
      data-dock-pane={tab.kind}
      data-testid={`dock-pane-${tab.id}`}
    >
      {children}
    </div>
  );
}

export function DockPanel() {
  const tabs = useShellUi((s) => s.dockTabs);
  const activeId = useShellUi((s) => s.dockActiveId);
  const { t } = useI18n();
  const hasPlan = useAgentStore((s) => s.plan != null || s.planDraft != null || s.pendingPlan != null);

  return (
    <>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        switch (tab.kind) {
          case 'browser':
            return <TabPane key={tab.id} tab={tab} active={active}><BrowserDock /></TabPane>;
          case 'files':
            return <TabPane key={tab.id} tab={tab} active={active}><FilesDock /></TabPane>;
          case 'agents':
            return <TabPane key={tab.id} tab={tab} active={active}><AgentsDock /></TabPane>;
          case 'usage':
            return <TabPane key={tab.id} tab={tab} active={active}><UsageDock /></TabPane>;
          case 'review':
            return <TabPane key={tab.id} tab={tab} active={active}><ChangesTab /></TabPane>;
          case 'plan':
            return <TabPane key={tab.id} tab={tab} active={active}><PlanDock /></TabPane>;
          case 'new-tab':
            return (
              <TabPane key={tab.id} tab={tab} active={active}>
                <DockLauncher
                  t={t}
                  hasPlan={hasPlan}
                  onOpen={(kind) => useShellUi.getState().openDockTab(kind)}
                />
              </TabPane>
            );
          case 'inspector':
          default:
            return <TabPane key={tab.id} tab={tab} active={active}><Inspector /></TabPane>;
        }
      })}
    </>
  );
}
