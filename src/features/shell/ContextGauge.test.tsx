/**
 * Vitest — F52 ContextGauge 环形仪表 + 纯函数档位/dashoffset。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextGauge, gaugeLevel, dashOffset } from './ContextGauge';
import { useAgentStore } from '@/stores/agentStore';

describe('gaugeLevel (F52 档位语义,与引擎 GaugeLevel 对齐)', () => {
  it('normal below 75%', () => {
    expect(gaugeLevel(0.1)).toBe('normal');
    expect(gaugeLevel(0.749)).toBe('normal');
  });
  it('warning at 75-89%', () => {
    expect(gaugeLevel(0.75)).toBe('warning');
    expect(gaugeLevel(0.89)).toBe('warning');
  });
  it('critical at 90%+', () => {
    expect(gaugeLevel(0.9)).toBe('critical');
    expect(gaugeLevel(1.0)).toBe('critical');
  });
});

describe('dashOffset', () => {
  it('full usage → offset 0 (full arc)', () => {
    expect(dashOffset(1)).toBe(0);
  });
  it('zero usage → full circumference (empty arc)', () => {
    expect(dashOffset(0)).toBeGreaterThan(0);
  });
  it('clamps out-of-range ratios', () => {
    expect(dashOffset(2)).toBe(0);
    expect(dashOffset(-1)).toBeCloseTo(dashOffset(0), 9);
  });
});

describe('ContextGauge component', () => {
  it('hidden when window size unknown', () => {
    useAgentStore.setState({ tokens: null, contextWindowSize: null });
    render(<ContextGauge />);
    expect(screen.queryByTestId('context-gauge')).toBeNull();
  });

  it('renders pct label and level at 50% usage', () => {
    useAgentStore.setState({ tokens: { input: 5, output: 5, cached: 0, cacheWrite: 0, total: 50, cost: 0.01, sessionCost: 0.02 }, contextWindowSize: 100 });
    render(<ContextGauge />);
    const gauge = screen.getByTestId('context-gauge');
    expect(gauge).toBeDefined();
    expect(gauge.textContent).toContain('50%');
    expect(gauge.dataset.level).toBe('normal');
  });

  it('critical level at 95% usage', () => {
    useAgentStore.setState({ tokens: { input: 95, output: 0, cached: 0, cacheWrite: 0, total: 95, cost: 0.01, sessionCost: 0.01 }, contextWindowSize: 100 });
    render(<ContextGauge />);
    expect(screen.getByTestId('context-gauge').dataset.level).toBe('critical');
  });

  it('warning level at 80% usage', () => {
    useAgentStore.setState({ tokens: { input: 80, output: 0, cached: 0, cacheWrite: 0, total: 80, cost: 0.01, sessionCost: 0.01 }, contextWindowSize: 100 });
    render(<ContextGauge />);
    expect(screen.getByTestId('context-gauge').dataset.level).toBe('warning');
  });
});
