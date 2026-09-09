import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
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

describe('QueuePanel keyboard navigation', () => {
  const rowsOf = (container) => [...container.querySelectorAll('ol > li')];

  it('keeps exactly one row in the tab order (roving tabindex)', () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const tabbables = rowsOf(container).filter(
      (r) => r.getAttribute('tabindex') === '0'
    );
    expect(tabbables.length).toBe(1);
    expect(tabbables[0]).toBe(rowsOf(container)[0]);
  });

  it('ArrowDown moves focus to the next row and moves the tab stop with it', async () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = rowsOf(container);
    rows[0].focus();
    await fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].getAttribute('tabindex')).toBe('0');
    expect(rows[0].getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowUp / Home / End navigate, and arrows clamp at the ends', async () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = rowsOf(container);
    await fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]); // clamped at top
    await fireEvent.keyDown(rows[0], { key: 'End' });
    expect(document.activeElement).toBe(rows[2]);
    await fireEvent.keyDown(rows[2], { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('arrows work when focus is on a button inside a row', async () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = rowsOf(container);
    const removeBtn = rows[0].querySelector('button[aria-label="Remove from queue"]');
    removeBtn.focus();
    await fireEvent.keyDown(removeBtn, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('Enter on a focused row plays that entry', async () => {
    const onPlayAt = vi.fn();
    const { container } = render(
      QueuePanel,
      { props: { queue: fakeQueue(), onPlayAt } }
    );
    const rows = rowsOf(container);
    await fireEvent.keyDown(rows[0], { key: 'Enter' });
    expect(onPlayAt).toHaveBeenCalledTimes(1);
    expect(onPlayAt).toHaveBeenCalledWith(0);
  });

  it('Enter on the current row is a no-op (mirrors the hidden play button)', async () => {
    const onPlayAt = vi.fn();
    const { container } = render(
      QueuePanel,
      { props: { queue: fakeQueue(), onPlayAt } }
    );
    const rows = rowsOf(container); // index 1 is current in fakeQueue
    await fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onPlayAt).not.toHaveBeenCalled();
  });

  it('swallows handled keys so global transport shortcuts stay quiet in the queue', async () => {
    const { container } = render(QueuePanel, { props: { queue: fakeQueue() } });
    const rows = rowsOf(container);
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      await fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
      await fireEvent.keyDown(rows[2], { key: 'Enter' }); // non-current row: swallowed
      await fireEvent.keyDown(rows[1], { key: 'x' }); // unhandled: must pass through
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
    expect(windowSpy).toHaveBeenCalledTimes(1); // only the 'x'
  });
});
