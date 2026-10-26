import { describe, expect, it } from 'vitest';
import { STRENGTHEN_INTRO, WHAT_THE_CUBE_DOES, getExplorerIntent, type ExplorerIntent } from '@/lib/explorer-intents';

describe('getExplorerIntent', () => {
  // Old stored values from before the flow collapse must still resolve.
  it.each<ExplorerIntent | undefined>(['analyse', 'navigate', 'discover', 'strengthen', 'troubleshoot', 'open', '', undefined])(
    'resolves %j to the single Analyse flow',
    (intent) => {
      expect(getExplorerIntent(intent).id).toBe('analyse');
    }
  );

  it('does not crash on an unknown value read from stored JSON', () => {
    expect(getExplorerIntent('bogus' as ExplorerIntent).id).toBe('analyse');
  });

  it('returns the same definition every time', () => {
    expect(getExplorerIntent('discover')).toBe(getExplorerIntent(undefined));
  });
});

describe('the Analyse flow', () => {
  const flow = getExplorerIntent('analyse');

  it('has its labels and opening message', () => {
    expect(flow.label).toBe('Analyse');
    expect(flow.chipLabel).toBe('Analysing');
    expect(flow.tracksDeployment).toBe(true);
    expect(flow.openingMessage).toBe(STRENGTHEN_INTRO);
  });

  it('numbers exactly totalSteps steps in its flow text', () => {
    expect(flow.totalSteps).toBe(5);
    for (let n = 1; n <= flow.totalSteps; n++) expect(flow.flow).toMatch(new RegExp(`^${n}\\. \\*\\*`, 'm'));
    expect(flow.flow).not.toMatch(new RegExp(`^${flow.totalSteps + 1}\\. \\*\\*`, 'm'));
  });

  it('tells the model when to set explorerAction to "analysis"', () => {
    expect(flow.flow).toContain('explorerAction');
    expect(flow.flow).toContain('"analysis"');
  });
});

describe('welcome copy', () => {
  it('is non-empty', () => {
    expect(WHAT_THE_CUBE_DOES.length).toBeGreaterThan(20);
    expect(STRENGTHEN_INTRO.length).toBeGreaterThan(20);
  });
});
