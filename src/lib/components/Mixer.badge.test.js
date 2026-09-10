import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'svelte/server';
import Mixer from './Mixer.svelte';

afterEach(() => {
  vi.unstubAllEnvs();
});

const props = (overrides = {}) => ({
  engine: null,
  deck1: null,
  deck2: null,
  deck1State: {},
  deck2State: {},
  masterVolume: 0.8,
  crossfader: 0.0,
  ...overrides
});

describe('Mixer broken-track badge', () => {
  it('renders no badge by default (flag off), even when a deck has loadError', () => {
    const { body } = render(Mixer, {
      props: props({ deck1State: { loadError: { code: 4 } } })
    });
    expect(body).not.toContain('role="alert"');
  });

  it('renders one badge on the errored channel when the flag is on', () => {
    vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
    const { body } = render(Mixer, {
      props: props({ deck1State: { loadError: { code: 4 } } })
    });
    const matches = body.match(/role="alert"/g) || [];
    expect(matches).toHaveLength(1);
    expect(body).toMatch(/load error/i);
  });

  it('renders a badge per channel when both decks have loadError', () => {
    vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
    const { body } = render(Mixer, {
      props: props({
        deck1State: { loadError: { code: 2 } },
        deck2State: { loadError: { code: 3 } }
      })
    });
    const matches = body.match(/role="alert"/g) || [];
    expect(matches).toHaveLength(2);
  });

  it('renders no badge when the flag is on but no deck has loadError', () => {
    vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
    const { body } = render(Mixer, { props: props() });
    expect(body).not.toContain('role="alert"');
  });
});
