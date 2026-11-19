import { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import type { DebugViewProps } from '@/contracts/basicPages';
import { useAgent } from '@/services/agent';

/** 读取 agent 状态并维护调试记录。 */
export function DebugBinding({ view: View }: { view: ComponentType<DebugViewProps> }) {
  const { turns, session } = useAgent();
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    setEvents((previous) => [...previous, `[${new Date().toLocaleTimeString()}] render`]);
  }, [turns.length, session]);
  return <View stateJson={JSON.stringify({ session, turns_count: turns.length }, null, 2)} events={events} />;
}
