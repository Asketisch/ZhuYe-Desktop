import type { ComponentType } from 'react';
import type { AgentEditorViewProps } from '@/contracts/agentWidgets';
export function AgentEditorBinding(props: Omit<AgentEditorViewProps, 'memoryScopes'> & { view: ComponentType<AgentEditorViewProps> }) {
  const { view: View, ...rest } = props;
  return <View {...rest} memoryScopes={['project', 'user', 'session']} />;
}
