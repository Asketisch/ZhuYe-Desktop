/**
 * ConfigHealthBanner —— F50 配置健康横幅。
 *
 * 启动时拉取 config.toml,客户端校验常见问题并在首页/设置页顶部提示:
 *
 * 1. **未配置 provider** —— `[active] provider` 为空 → 无法对话;
 * 2. **注入防护被关闭** —— F01 起 prompt_guard 默认开启,显式关闭是
 *    安全相关变化,要让用户看见(而不是静默失效);
 * 3. **OS 沙箱未启用** —— 提示(非阻断:平台可能不支持)。
 *
 * 纯客户端检查(readField 解析 TOML),无需引擎新命令。每条 warning
 * 可单独关闭(dismiss 按 issue key 存储)。
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TriangleAlert, ShieldOff, ShieldQuestion } from 'lucide-react';
import { Badge, Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_get_config } from '@/utils/commands/config';
import { ping } from '@/utils/commands/health';
import { readField } from '@/features/settings/configSchema';
import s from './ConfigHealthBanner.module.css';

/** 一条健康检查项。 */
export interface HealthIssue {
  /** 稳定 key(dismiss 存储)。 */
  key: string;
  /** 严重级:warn 可继续用,critical 无法正常工作。 */
  level: 'critical' | 'warn';
  message: string;
}

/** 纯函数:从 config.toml 内容派生健康问题(供测试与组件共用)。 */
export function deriveConfigIssues(toml: string): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // ① provider 未配置
  const provider = readField(toml, 'active', 'provider').trim();
  const anthropicKey = readField(toml, 'anthropic', 'api_key').trim();
  const openaiKey = readField(toml, 'openai', 'api_key').trim();
  if (!provider && !anthropicKey && !openaiKey) {
    issues.push({
      key: 'no-provider',
      level: 'critical',
      message: '未配置模型 provider —— 无法开始对话。请在设置中添加 provider 与 API key。',
    });
  }

  // ② prompt_guard 被显式关闭(F01 默认开启;关闭是安全相关决定)
  const guardRaw = readField(toml, 'prompt_guard', 'enabled').trim();
  if (guardRaw === 'false') {
    issues.push({
      key: 'guard-disabled',
      level: 'warn',
      message: '提示注入防护已关闭:工具输出与外部工具定义不再被扫描,注入内容可能进入模型上下文。',
    });
  }

  // ③ OS 沙箱未启用(提示级)
  const sandboxRaw = readField(toml, 'sandbox', 'os_level').trim();
  if (sandboxRaw === 'false' || (sandboxRaw === '' && readField(toml, 'sandbox', 'allow_network').trim() === '')) {
    issues.push({
      key: 'sandbox-off',
      level: 'warn',
      message: 'OS 沙箱未启用:bash 命令将直接在宿主环境运行(写权限不受限)。',
    });
  }

  return issues;
}

export function ConfigHealthBanner() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [drill, setDrill] = useState<{ backend: boolean; config: boolean } | null>(null);
  const configQ = useQuery({
    queryKey: ['config-health'],
    queryFn: reflect_get_config,
    staleTime: 60_000,
  });

  const issues = configQ.data ? deriveConfigIssues(configQ.data) : [];
  const visible = issues.filter((i) => !dismissed.includes(i.key));
  // drill 行独立于 issues(healthy 时也可探活);仅 loading 时不渲染。
  if (configQ.isLoading) return null;

  // F50 --drill:逐项探活(后端 ping + config 读取),结构化结果展示。
  const runDrill = async () => {
    const results: { backend: boolean; config: boolean } = { backend: false, config: false };
    try {
      await ping();
      results.backend = true;
    } catch {
      results.backend = false;
    }
    try {
      await reflect_get_config();
      results.config = true;
    } catch {
      results.config = false;
    }
    setDrill(results);
  };

  return (
    <Card level="flat" padding="sm" className={s.banner} data-testid="config-health-banner">
      {visible.length > 0 && visible.map((issue) => (
        <div key={issue.key} className={s.row} data-testid={`config-issue-${issue.key}`}>
          <Icon
            icon={issue.level === 'critical' ? TriangleAlert : ShieldOff}
            size={13}
            className={issue.level === 'critical' ? s.critical : s.warn}
          />
          <span className={s.text}>{issue.message}</span>
          <Badge variant={issue.level === 'critical' ? 'danger' : 'warning'}>
            {issue.level === 'critical'
              ? t('settings.configHealth.critical')
              : t('settings.configHealth.warn')}
          </Badge>
          <button
            type="button"
            className={s.dismiss}
            aria-label={t('common.close')}
            onClick={() => setDismissed((d) => [...d, issue.key])}
          >
            ×
          </button>
        </div>
      ))}
      {issues.some((i) => i.key === 'sandbox-off') && (
        <div className={s.hint}>
          <Icon icon={ShieldQuestion} size={11} />
          {t('settings.configHealth.sandboxHint')}
        </div>
      )}
      {/* F50 doctor --drill 等价:逐项探活,结果结构化展示。 */}
      <div className={s.drillRow} data-testid="config-drill">
        <button type="button" className={s.drillBtn} onClick={() => void runDrill()}>
          {t('settings.configHealth.drill')}
        </button>
        {drill && (
          <span className={s.drillResults} data-testid="config-drill-results">
            backend: {drill.backend ? 'ok' : 'fail'} · config: {drill.config ? 'ok' : 'fail'}
          </span>
        )}
      </div>
    </Card>
  );
}
