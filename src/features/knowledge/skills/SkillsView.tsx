import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SkillsBinding } from '@/logic/knowledge/skills/SkillsBinding';
import { SkillsView as DefaultView } from '@/render/knowledge/skills/SkillsView';

export function SkillsView() {
  const View = useRenderView('SkillsView', DefaultView);
  return <SkillsBinding view={View} />;
}
