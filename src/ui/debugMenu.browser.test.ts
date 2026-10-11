import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugMenu, type DebugControls, type DebugLightInfo, type DebugLights, type DebugMenu } from './debugMenu';

/** In-memory light rig standing in for the stage's registry; records selections. */
interface LightRig extends DebugLights {
  lights: DebugLightInfo[];
  selected: (string | null)[];
}

function lightRig(): LightRig {
  const lights: DebugLightInfo[] = [
    { id: 'a', name: 'Ambient', type: 'ambient', enabled: true, color: '#ffffff', intensity: 0.5, x: 0, y: 0, z: 0 },
    { id: 'k', name: 'Key', type: 'directional', enabled: true, color: '#ffeedd', intensity: 1.5, x: 1, y: 2, z: 3 },
  ];
  const selected: (string | null)[] = [];
  return {
    lights,
    selected,
    list: () => lights.map((l) => ({ ...l })),
    set: (id, key, value) => Object.assign(lights.find((l) => l.id === id)!, { [key]: value }),
    add: (type) => lights.push({ id: `n${lights.length}`, name: `New ${type}`, type, enabled: true, color: '#00ff00', intensity: 1, x: 5, y: 6, z: 7 }),
    select: (id) => selected.push(id),
  };
}

let state: { speed: number; on: boolean; mode: string };
let rig: LightRig;
let ran: string[];
let changes: number;
let menu: DebugMenu;

function controls(): DebugControls {
  return {
    groups: [
      {
        title: 'Coin Physics',
        params: [
          { kind: 'number', key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.5, get: () => state.speed, set: (v) => (state.speed = v), rebuild: true },
          { kind: 'toggle', key: 'on', label: 'Enabled', get: () => state.on, set: (v) => (state.on = v) },
          { kind: 'choice', key: 'mode', label: 'Mode', options: ['fast', 'slow'], get: () => state.mode, set: (v) => (state.mode = v) },
        ],
      },
      { title: 'Hidden', collapsed: true, params: [] },
    ],
    actions: [
      { label: 'Go', group: 'A', run: () => ran.push('go') },
      { label: 'Stop', run: () => ran.push('stop') },
    ],
    lights: rig,
    stats: () => `speed=${state.speed}`,
    onChange: () => changes++,
  };
}

const q = <T extends Element>(selector: string): T => menu.element.querySelector<T>(selector)!;
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!;
const fire = (el: Element, type: string): boolean => el.dispatchEvent(new Event(type, { bubbles: true }));

beforeEach(() => {
  state = { speed: 2, on: false, mode: 'fast' };
  rig = lightRig();
  ran = [];
  changes = 0;
  localStorage.removeItem('vicky.debugPreset');
});
afterEach(() => {
  menu.dispose();
  vi.useRealTimers();
});

describe('debug menu', () => {
  it('renders groups, collapsed state, rebuild badges, and grouped action buttons', () => {
    menu = createDebugMenu(document.body, controls(), true);
    const groups = [...menu.element.querySelectorAll('details')];
    expect(groups.map((d) => d.querySelector('summary')!.textContent)).toEqual(['Coin Physics', 'Hidden', 'Lighting', 'Presets']);
    expect(groups[1]!.open).toBe(false);
    expect(q('.debug-menu__rebuild').textContent).toBe('rebuild');
    button('Go').click();
    button('Stop').click();
    expect(ran).toEqual(['go', 'stop']);
  });

  it('applies slider, typed number, checkbox, and select edits through the param setters', () => {
    menu = createDebugMenu(document.body, controls(), true);
    const range = q<HTMLInputElement>('input[type=range]');
    range.value = '4.5';
    fire(range, 'input');
    expect(state.speed).toBe(4.5);
    expect(q('.debug-menu__badge').textContent).toBe('4.5');

    const typed = q<HTMLInputElement>('.debug-menu__num');
    typed.value = '7';
    fire(typed, 'change');
    expect(state.speed).toBe(7);
    typed.value = 'nope';
    fire(typed, 'change');
    expect(state.speed).toBe(7);

    const box = q<HTMLInputElement>('input[type=checkbox]');
    box.checked = true;
    fire(box, 'change');
    expect(state.on).toBe(true);

    const select = q<HTMLSelectElement>('select');
    select.value = 'slow';
    fire(select, 'change');
    expect(state.mode).toBe('slow');
    expect(changes).toBe(4);
    expect(JSON.parse(q<HTMLTextAreaElement>('textarea').value)).toEqual({ 'coin_physics.speed': 7, 'coin_physics.on': true, 'coin_physics.mode': 'slow' });
  });

  it('refresh picks up values changed elsewhere', () => {
    menu = createDebugMenu(document.body, controls(), true);
    state.speed = 9;
    state.on = true;
    state.mode = 'slow';
    menu.refresh();
    expect(q<HTMLInputElement>('input[type=range]').value).toBe('9');
    expect(q<HTMLInputElement>('input[type=checkbox]').checked).toBe(true);
    expect(q<HTMLSelectElement>('select').value).toBe('slow');
  });

  it('saves, loads, and resets presets, ignoring unknown or mistyped entries', () => {
    menu = createDebugMenu(document.body, controls(), true);
    state.speed = 5;
    button('Save preset').click();
    state.speed = 1;
    button('Load preset').click();
    expect(state.speed).toBe(5);

    localStorage.setItem('vicky.debugPreset', JSON.stringify({ 'coin_physics.speed': 'fast', 'coin_physics.mode': 'warp', 'coin_physics.on': true, 'nope.x': 1 }));
    button('Load preset').click();
    expect(state).toEqual({ speed: 5, on: true, mode: 'fast' });

    localStorage.setItem('vicky.debugPreset', '{broken');
    button('Load preset').click();
    expect(localStorage.getItem('vicky.debugPreset')).toBeNull();
    button('Load preset').click(); // nothing saved: no-op

    button('Reset to defaults').click();
    expect(state).toEqual({ speed: 2, on: false, mode: 'fast' });
  });

  it('copies the current values to the clipboard', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    menu = createDebugMenu(document.body, controls(), true);
    button('Copy').click();
    expect(writeText).toHaveBeenCalledWith(q<HTMLTextAreaElement>('textarea').value);
  });

  it('edits the selected light and adds new lights', () => {
    menu = createDebugMenu(document.body, controls(), true);
    const lighting = [...menu.element.querySelectorAll('details')].find((d) => d.querySelector('summary')!.textContent === 'Lighting')!;
    const [select] = lighting.querySelectorAll('select');
    expect([...select!.options].map((o) => o.value)).toEqual(['a', 'k']);
    const [x] = [...lighting.querySelectorAll<HTMLInputElement>('input[type=number]')].filter((i) => i.title === 'x');
    expect(x!.disabled).toBe(true); // ambient has no position

    select!.value = 'k';
    fire(select!, 'change');
    expect(rig.selected.at(-1)).toBe('k');
    expect(x!.disabled).toBe(false);
    expect(x!.value).toBe('1');

    const inputs = lighting.querySelectorAll<HTMLInputElement>('input');
    const enabled = [...inputs].find((i) => i.type === 'checkbox')!;
    const color = [...inputs].find((i) => i.type === 'color')!;
    const intensity = [...inputs].find((i) => i.type === 'number' && !i.title)!;
    enabled.checked = false;
    fire(enabled, 'change');
    color.value = '#123456';
    fire(color, 'input');
    intensity.value = '3';
    fire(intensity, 'input');
    x!.value = '-4';
    fire(x!, 'input');
    expect(rig.lights[1]).toMatchObject({ enabled: false, color: '#123456', intensity: 3, x: -4 });

    button('Add spot light').click();
    expect(select!.value).toBe('n2');
    expect(rig.selected.at(-1)).toBe('n2');

    lighting.open = false;
    lighting.dispatchEvent(new Event('toggle'));
    expect(rig.selected.at(-1)).toBeNull();
  });

  it('toggles with backquote and the DEBUG button, refreshing stats while open', () => {
    vi.useFakeTimers();
    menu = createDebugMenu(document.body, controls(), false);
    expect(menu.element.hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`' }));
    expect(menu.element.hidden).toBe(false);
    state.speed = 8;
    vi.advanceTimersByTime(500);
    expect(q('.debug-menu__stats').textContent).toBe('speed=8');
    expect(q<HTMLInputElement>('input[type=range]').value).toBe('8');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', repeat: true }));
    expect(menu.element.hidden).toBe(false);
    button('DEBUG').click();
    expect(menu.element.hidden).toBe(true);
  });

  it('keeps typing inside the panel away from the game, and ignores backquote typed in other inputs', () => {
    menu = createDebugMenu(document.body, controls(), true);
    const outside = document.createElement('input');
    document.body.append(outside);
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent): number => seen.push(e.key);
    window.addEventListener('keydown', onKey);
    q('.debug-menu__num').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
    window.removeEventListener('keydown', onKey);
    outside.remove();
    expect(seen).toEqual(['`']);
    expect(menu.element.hidden).toBe(false);
  });

  it('does not overwrite a light field while it is being typed in, and ignores non-numeric input', () => {
    vi.useFakeTimers();
    menu = createDebugMenu(document.body, controls(), true);
    const lighting = [...menu.element.querySelectorAll('details')].find((d) => d.querySelector('summary')!.textContent === 'Lighting')!;
    const select = lighting.querySelector('select')!;
    select.value = 'k';
    fire(select, 'change');
    const intensity = [...lighting.querySelectorAll<HTMLInputElement>('input[type=number]')].find((i) => !i.title)!;
    lighting.open = true; // collapsed <details> content cannot take focus
    intensity.focus();
    intensity.value = '9';
    rig.lights[1]!.intensity = 2;
    vi.advanceTimersByTime(500); // periodic refresh
    expect(intensity.value).toBe('9');
    intensity.value = 'abc';
    fire(intensity, 'input');
    expect(rig.lights[1]!.intensity).toBe(2);
    intensity.blur();
    vi.advanceTimersByTime(500);
    expect(intensity.value).toBe('2');
  });

  it('leaves light edits inert when the rig has no lights, and works without stats', () => {
    rig.lights.splice(0);
    const { stats: _stats, ...rest } = controls();
    menu = createDebugMenu(document.body, rest, true);
    expect(menu.element.querySelector('.debug-menu__stats')).toBeNull();
    const lighting = [...menu.element.querySelectorAll('details')].find((d) => d.querySelector('summary')!.textContent === 'Lighting')!;
    const color = lighting.querySelector<HTMLInputElement>('input[type=color]')!;
    color.value = '#abcdef';
    fire(color, 'input');
    expect(changes).toBe(0);
  });

  it('toggles on backquote typed inside its own inputs', () => {
    menu = createDebugMenu(document.body, controls(), true);
    q('.debug-menu__num').dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
    expect(menu.element.hidden).toBe(true);
  });

  it('dispose removes the panel and stops listening', () => {
    menu = createDebugMenu(document.body, controls(), true);
    menu.dispose();
    expect(document.querySelector('.debug-menu')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`' }));
    expect(menu.element.hidden).toBe(false);
  });
});
