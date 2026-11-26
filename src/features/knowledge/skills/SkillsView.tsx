import { useRenderView } from '@/logic/renderer/useRenderView';
import { SkillsBinding } from '@/logic/skills/SkillsBinding';
import { SkillsView as DefaultView } from '@/render/knowledge/skills/SkillsView';

export function SkillsView() {
  const View = useRenderView('SkillsView', DefaultView);
  return <SkillsBinding view={View} />;
}
