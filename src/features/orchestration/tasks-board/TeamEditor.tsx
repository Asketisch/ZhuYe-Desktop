import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { TeamEditorBinding } from '@/logic/orchestration/tasks-board/TeamEditorBinding';
import { TeamEditor as DefaultView } from '@/render/orchestration/tasks-board/TeamEditor';
import type { TeamEditorBindingProps } from '@/contracts/orchestration/taskWidgets';
export type TeamEditorProps = Omit<TeamEditorBindingProps, 't'>;
export { leadAgentIdFor } from '@/logic/orchestration/tasks-board/useTeamEditor';
export function TeamEditor(props: TeamEditorProps) { const { t } = useI18n(); const View = useRenderView('TeamEditor', DefaultView); return <TeamEditorBinding view={View} t={t} {...props} />; }
