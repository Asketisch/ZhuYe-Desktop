/**
 * Design System —— 组件库 catalog（活体参考）。
 *
 * 展示全部 primitive + token，消费方参考用。
 */
import {
  MessageSquare,
  Settings as SettingsIcon,
  Folder,
  Plus,
  Search,
  Check,
  AlertTriangle,
  Info,
  XCircle,
  Loader2,
  Sun,
  Moon,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Icon,
  Input,
  Textarea,
  Select,
  Badge,
  Card,
  EmptyState,
  Spinner,
  Tooltip,
  Toast,
  ContextRing,
  KeyHint,
} from '@/features/design-system';
import s from './DesignSystemView.module.css';

export function DesignSystemView() {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Design System</h1>
        <p className={s.subtitle}>ReflectDesktop 组件库 catalog —— 深色优先，token 驱动。</p>
      </header>

      {/* ===== Colors ===== */}
      <section className={s.section} data-section="colors">
        <h2 className={s.sectionTitle}>Colors</h2>
        <div className={s.swatches}>
          {(
            [
              ['bg-app', 'var(--bg-app)'],
              ['bg-surface', 'var(--bg-surface)'],
              ['bg-elevated', 'var(--bg-elevated)'],
              ['accent', 'var(--accent)'],
              ['success', 'var(--success)'],
              ['warning', 'var(--warning)'],
              ['danger', 'var(--danger)'],
              ['info', 'var(--info)'],
            ] as const
          ).map(([name, val]) => (
            <div key={name} className={s.swatch}>
              <div className={s.swatchChip} style={{ background: val }} />
              <div className={s.swatchName}>{name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Typography ===== */}
      <section className={s.section} data-section="typography">
        <h2 className={s.sectionTitle}>Typography</h2>
        <div className={s.typo}>
          <div className={s.typoRow} style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700 }}>
            Heading 1
          </div>
          <div className={s.typoRow} style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600 }}>
            Heading 2
          </div>
          <div className={s.typoRow} style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
            Heading 3
          </div>
          <div className={s.typoRow} style={{ fontSize: 'var(--fs-base)' }}>
            Body text — 14px, regular weight
          </div>
          <div className={s.typoRow} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            Caption — 12px, muted
          </div>
        </div>
      </section>

      {/* ===== Buttons ===== */}
      <section className={s.section} data-section="buttons">
        <h2 className={s.sectionTitle}>Buttons</h2>
        <div className={s.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className={s.row}>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="md">Medium</Button>
          <Button variant="primary" size="lg">Large</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="secondary" leftIcon={<Icon icon={Plus} size={14} />}>With icon</Button>
        </div>
        <div className={s.row}>
          <IconButton label="New chat" variant="default">
            <Icon icon={MessageSquare} size={16} />
          </IconButton>
          <IconButton label="Settings" variant="active">
            <Icon icon={SettingsIcon} size={16} />
          </IconButton>
          <IconButton label="Add" variant="primary">
            <Icon icon={Plus} size={16} />
          </IconButton>
          <Tooltip label="Search (⌘K)">
            <IconButton label="Search">
              <Icon icon={Search} size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </section>

      {/* ===== Form controls ===== */}
      <section className={s.section} data-section="forms">
        <h2 className={s.sectionTitle}>Form controls</h2>
        <div className={s.forms}>
          <Input placeholder="Plain input" aria-label="Plain input" />
          <Input leading={<Icon icon={Search} size={14} />} placeholder="Search input" aria-label="Search input" />
          <Select defaultValue="a" aria-label="Demo select">
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </Select>
          <Textarea placeholder="Textarea" rows={3} aria-label="Textarea" />
        </div>
      </section>

      {/* ===== Badges ===== */}
      <section className={s.section} data-section="badges">
        <h2 className={s.sectionTitle}>Badges</h2>
        <div className={s.row}>
          <Badge variant="neutral">neutral</Badge>
          <Badge variant="accent">accent</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="success" dot>online</Badge>
          <Badge variant="accent" solid>12</Badge>
        </div>
      </section>

      {/* ===== Card ===== */}
      <section className={s.section} data-section="card">
        <h2 className={s.sectionTitle}>Card</h2>
        <div className={s.row}>
          <Card level="outlined" padding="md" style={{ width: 200 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Outlined card</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              描边卡片，默认用于内容容器。
            </div>
          </Card>
          <Card level="elevated" padding="md" style={{ width: 200 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Elevated card</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              阴影提升，用于 popover / modal。
            </div>
          </Card>
        </div>
      </section>

      {/* ===== Context Ring ===== */}
      <section className={s.section} data-section="context-ring">
        <h2 className={s.sectionTitle}>Context Ring</h2>
        <ContextRing
          segments={[
            { label: 'tools', value: 0.15, color: '#5dd1c6' },
            { label: 'system', value: 0.1, color: '#4ade80' },
            { label: 'skills', value: 0.05, color: '#fbbf24' },
            { label: 'messages', value: 0.3, color: '#a78bfa' },
          ]}
          label="60% used"
        />
      </section>

      {/* ===== Toast ===== */}
      <section className={s.section} data-section="toast">
        <h2 className={s.sectionTitle}>Toast</h2>
        <div className={s.toastCol}>
          <Toast kind="info" message="Configuration reloaded" onDismiss={() => {}} />
          <Toast kind="success" message="Session renamed" onDismiss={() => {}} />
          <Toast kind="warning" message="Context nearly full" onDismiss={() => {}} />
          <Toast kind="error" message="Failed to fetch sessions" onDismiss={() => {}} />
        </div>
      </section>

      {/* ===== Key Hints ===== */}
      <section className={s.section} data-section="key-hints">
        <h2 className={s.sectionTitle}>Key Hints</h2>
        <div className={s.row}>
          <KeyHint combo="Cmd+Enter" platform="macos" label="Send" />
          <KeyHint combo="Cmd+." platform="macos" label="Interrupt" />
          <KeyHint combo="Ctrl+Enter" platform="other" label="Send" />
          <KeyHint combo="Esc" platform="other" label="Cancel" />
        </div>
      </section>

      {/* ===== Icons ===== */}
      <section className={s.section} data-section="icons">
        <h2 className={s.sectionTitle}>Icons (lucide-react via Icon)</h2>
        <div className={s.row} style={{ color: 'var(--text-secondary)' }}>
          <Icon icon={MessageSquare} /><Icon icon={SettingsIcon} /><Icon icon={Folder} />
          <Icon icon={Plus} /><Icon icon={Search} /><Icon icon={Check} />
          <Icon icon={AlertTriangle} /><Icon icon={Info} /><Icon icon={XCircle} />
          <Icon icon={Loader2} /><Icon icon={Sun} /><Icon icon={Moon} />
        </div>
      </section>

      {/* ===== Spinner + EmptyState ===== */}
      <section className={s.section} data-section="state">
        <h2 className={s.sectionTitle}>Spinner & EmptyState</h2>
        <div className={s.row}>
          <Spinner size={20} />
          <Card level="flat" padding="none" style={{ flex: 1, maxWidth: 360 }}>
            <EmptyState
              icon={<Icon icon={MessageSquare} />}
              title="No sessions yet"
              description="开始一次对话，会话会出现在这里。"
              action={<Button variant="primary" size="sm" leftIcon={<Icon icon={Plus} size={14} />}>New chat</Button>}
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
