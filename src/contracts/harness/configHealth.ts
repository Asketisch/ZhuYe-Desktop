/** 配置诊断使用的稳定问题代码。 */
export type ConfigHealthKey = 'no-provider' | 'guard-disabled' | 'sandbox-off';

export interface ConfigHealthIssue {
  key: ConfigHealthKey;
  level: 'critical' | 'warn';
}

export interface ConfigHealthViewProps {
  issues: Array<ConfigHealthIssue & { message: string }>;
  showSandboxHint: boolean;
  drill: { backend: boolean; config: boolean } | null;
  labels: { critical: string; warn: string; close: string; sandboxHint: string; drill: string };
  onDismiss: (key: ConfigHealthKey) => void;
  onDrill: () => void;
}
