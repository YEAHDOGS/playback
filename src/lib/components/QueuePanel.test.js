import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { compile } from 'svelte/compiler';
import source from './QueuePanel.svelte?raw';
import QueuePanel from './QueuePanel.svelte';

// Regression coverage for the queue panel's screen-reader surface:
// every icon-only button must expose an accessible name, and the
// currently-playing row must be marked with aria-current.
const fakeQueue = () => ({
  items: [
    { id: 'a', title: 'Track A', artist: 'Artist A', url: 'https://example.com/a.mp3' },
    { id: 'b', title: 'Track B', artist: 'Artist B', url: 'https://example.com/b.mp3' },
    { id: 'c', title: 'Track C', artist: 'Artist C', url: 'https://example.com/c.mp3' }
  ],
  index: 1
});

describe('QueuePanel a11y', () => {
  it('compiles with zero warnings (repo bar: warnings are future bugs)', () => {
    const { warnings } = compile(source, { filename: 'QueuePanel.svelte' });
    expect(warnings).toEqual([]);
  });

  it('every button has an accessible name', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    const unnamed = buttons.filter(
      (b) => !(b.getAttribute('aria-label') || b.textContent.trim())
    );
    expect(unnamed.map((b) => b.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('header transport buttons announce their actions', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const names = [...container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label')
    );
    for (const expected of ['Previous in queue', 'Next in queue', 'Clear queue']) {
      expect(names).toContain(expected);
    }
  });

  it('marks exactly the current track row with aria-current', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = [...container.querySelectorAll('ol > li')];
    expect(rows.length).toBe(3);
    rows.forEach((row, i) => {
      if (i === 1) expect(row.getAttribute('aria-current')).toBe('true');
      else expect(row.getAttribute('aria-current')).toBeNull();
    });
  });

  it('disables move buttons at the queue edges', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = [...container.querySelectorAll('ol > li')];
    const byLabel = (row, label) =>
      row.querySelector(`button[aria-label="${label}"]`);
    expect(byLabel(rows[0], 'Move up').disabled).toBe(true);
    expect(byLabel(rows[0], 'Move down').disabled).toBe(false);
    expect(byLabel(rows[2], 'Move down').disabled).toBe(true);
    expect(byLabel(rows[2], 'Move up').disabled).toBe(false);
  });

  it('labels the track list for screen readers', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const list = container.querySelector('ol');
    expect(list.getAttribute('aria-label')).toBe('Session queue');
  });

  it('announces the dropped-tracks notice via a live region', () => {
    const { container } = render(
      QueuePanel,
      { props: { queue: fakeQueue(), droppedCount: 2 } }
    );
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('2');
  });

  it('shows no dropped-tracks notice when nothing was dropped', () => {
    const { container } = render(
      QueuePanel,
      { props: { queue: fakeQueue(), droppedCount: 0 } }
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
