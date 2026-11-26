import { useRenderView } from '@/logic/renderer/useRenderView';
import { SquadBinding } from '@/logic/squad/SquadBinding';
import { SquadView as DefaultView } from '@/render/squad/SquadView';
import { SquadTaskRow } from './SquadTaskRow';

export function SquadView() {
  const View = useRenderView('SquadView', DefaultView);
  return <SquadBinding view={View} SquadTaskRow={SquadTaskRow} />;
}
