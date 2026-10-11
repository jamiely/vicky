import './debugMenu.css';

export interface DebugNumber { kind: 'number'; key: string; label: string; min: number; max: number; step: number; get(): number; set(value: number): void; /** true = takes effect after 'Rebuild machine' */ rebuild?: boolean }
export interface DebugToggle { kind: 'toggle'; key: string; label: string; get(): boolean; set(value: boolean): void; rebuild?: boolean }
export interface DebugChoice { kind: 'choice'; key: string; label: string; options: readonly string[]; get(): string; set(value: string): void }
export type DebugParam = DebugNumber | DebugToggle | DebugChoice;
export interface DebugGroup { title: string; params: DebugParam[]; collapsed?: boolean }
export interface DebugAction { label: string; run(): void; group?: string }
export interface DebugLightInfo { id: string; name: string; type: 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot'; enabled: boolean; color: string; intensity: number; x: number; y: number; z: number }
export interface DebugLights { list(): DebugLightInfo[]; set(id: string, key: 'enabled' | 'color' | 'intensity' | 'x' | 'y' | 'z', value: boolean | string | number): void; add(type: 'point' | 'spot'): void; select(id: string | null): void }
export interface DebugControls { groups: DebugGroup[]; actions: DebugAction[]; lights?: DebugLights; /** One-line live stats (fps, bodies...), polled ~4x/s. */ stats?(): string; /** Called after any value change so the host can refresh dependent state. */ onChange?(): void }
export interface DebugMenu { element: HTMLElement; toggle(): void; refresh(): void; /** Stops timers, unbinds keys, removes the DOM. */ dispose(): void }

type ParamValue = number | boolean | string;

const PRESET_KEY = 'vicky.debugPreset';
const LIGHT_AXES = ['x', 'y', 'z'] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Mounts the panel (hidden unless `open`); backquote (`) toggles visibility; returns a handle. */
export function createDebugMenu(host: HTMLElement, controls: DebugControls, open: boolean): DebugMenu {
  const root = el('aside', 'debug-menu');
  root.hidden = !open;
  const stopKeys = (e: KeyboardEvent): void => {
    if (e.key !== '`') e.stopPropagation();
  };
  root.addEventListener('keydown', stopKeys);
  root.addEventListener('keyup', stopKeys);

  root.append(el('h3', undefined, 'DEBUG'));
  const statsLine = el('div', 'debug-menu__stats');
  if (controls.stats) root.append(statsLine);

  const params = new Map<string, DebugParam>();
  const refreshers: Array<() => void> = [];
  const changed = (): void => {
    controls.onChange?.();
    jsonBox.value = JSON.stringify(snapshot(), null, 2);
  };

  // Actions, bucketed by optional group.
  const actionRows: Record<string, HTMLDivElement> = {};
  const actionsWrap = el('div');
  root.append(actionsWrap);
  const addButton = (label: string, run: () => void, group = ''): void => {
    let row = actionRows[group];
    if (!row) {
      row = el('div', 'debug-menu__actions');
      actionRows[group] = row;
      actionsWrap.append(row);
    }
    const button = el('button', undefined, label);
    button.type = 'button';
    button.addEventListener('click', run);
    row.append(button);
  };
  for (const action of controls.actions) addButton(action.label, () => action.run(), action.group);

  // Parameter groups.
  for (const group of controls.groups) {
    const details = el('details', 'debug-menu__group');
    details.open = !group.collapsed;
    details.append(el('summary', undefined, group.title));
    const body = el('div', 'debug-menu__body');
    details.append(body);
    root.append(details);
    for (const param of group.params) {
      params.set(`${slug(group.title)}.${param.key}`, param);
      body.append(buildParam(param));
    }
  }

  function buildParam(param: DebugParam): HTMLElement {
    const row = el('div', 'debug-menu__row');
    const label = el('label', 'debug-menu__label');
    label.append(el('span', undefined, param.label));
    if (param.kind !== 'choice' && param.rebuild) label.append(el('span', 'debug-menu__rebuild', 'rebuild'));
    row.append(label);
    const inputs = el('div', 'debug-menu__inputs');
    row.append(inputs);

    if (param.kind === 'number') {
      const badge = el('span', 'debug-menu__badge');
      label.append(badge);
      const range = el('input');
      range.type = 'range';
      range.min = String(param.min);
      range.max = String(param.max);
      range.step = String(param.step);
      const num = el('input', 'debug-menu__num');
      num.type = 'text';
      num.inputMode = 'decimal';
      const show = (v: number): void => {
        range.value = String(v);
        badge.textContent = formatNumber(v, param.step);
        if (document.activeElement !== num) num.value = String(v);
      };
      range.addEventListener('input', () => {
        param.set(Number(range.value));
        show(param.get());
        changed();
      });
      num.addEventListener('change', () => {
        const v = Number(num.value);
        if (Number.isFinite(v)) {
          param.set(v);
          changed();
        }
        num.blur();
        show(param.get());
      });
      inputs.append(range, num);
      refreshers.push(() => show(param.get()));
    } else if (param.kind === 'toggle') {
      const box = el('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        param.set(box.checked);
        changed();
      });
      label.prepend(box);
      refreshers.push(() => { box.checked = param.get(); });
    } else {
      const select = el('select');
      for (const option of param.options) select.append(new Option(option, option));
      select.addEventListener('change', () => {
        param.set(select.value);
        changed();
      });
      inputs.append(select);
      refreshers.push(() => { select.value = param.get(); });
    }
    return row;
  }

  // Lighting editor.
  const lights = controls.lights;
  if (lights) {
    const details = el('details', 'debug-menu__group');
    details.append(el('summary', undefined, 'Lighting'));
    const body = el('div', 'debug-menu__body');
    details.append(body);
    root.append(details);

    const select = el('select');
    const enabled = el('input');
    enabled.type = 'checkbox';
    const color = el('input');
    color.type = 'color';
    const intensity = el('input', 'debug-menu__num');
    intensity.type = 'number';
    intensity.step = '0.05';
    const axisInput = (axis: string): HTMLInputElement => {
      const input = el('input', 'debug-menu__num');
      input.type = 'number';
      input.step = '0.1';
      input.title = axis;
      return input;
    };
    const axisInputs: Record<(typeof LIGHT_AXES)[number], HTMLInputElement> = { x: axisInput('x'), y: axisInput('y'), z: axisInput('z') };
    const rowOf = (text: string, ...nodes: HTMLElement[]): HTMLElement => {
      const row = el('div', 'debug-menu__inputs');
      row.append(el('span', undefined, text), ...nodes);
      return row;
    };
    const addRow = el('div', 'debug-menu__actions');
    for (const type of ['point', 'spot'] as const) {
      const button = el('button', undefined, `Add ${type} light`);
      button.type = 'button';
      button.addEventListener('click', () => {
        lights.add(type);
        const list = lights.list();
        syncLights(list[list.length - 1]?.id);
        changed();
      });
      addRow.append(button);
    }
    body.append(select, rowOf('Enabled', enabled, color), rowOf('Intensity', intensity), rowOf('Pos', axisInputs.x, axisInputs.y, axisInputs.z), addRow);

    const syncLights = (selectId?: string): void => {
      const list = lights.list();
      const keep = selectId ?? select.value;
      if (select.options.length !== list.length || list.some((l, i) => select.options[i]?.value !== l.id)) {
        select.replaceChildren(...list.map((l) => new Option(`${l.name} (${l.type})`, l.id)));
      }
      if (list.some((l) => l.id === keep)) select.value = keep;
      if (selectId !== undefined) lights.select(select.value || null);
      const info = list.find((l) => l.id === select.value);
      const focused = document.activeElement;
      if (!info) return;
      enabled.checked = info.enabled;
      if (focused !== color) color.value = info.color;
      if (focused !== intensity) intensity.value = String(info.intensity);
      for (const axis of LIGHT_AXES) {
        const input = axisInputs[axis];
        input.disabled = info.type === 'ambient' || info.type === 'hemisphere';
        if (focused !== input) input.value = String(info[axis]);
      }
    };
    const apply = (key: 'enabled' | 'color' | 'intensity' | 'x' | 'y' | 'z', value: boolean | string | number): void => {
      if (!select.value) return;
      lights.set(select.value, key, value);
      changed();
    };
    select.addEventListener('change', () => syncLights(select.value));
    details.addEventListener('toggle', () => lights.select(details.open ? select.value || null : null));
    enabled.addEventListener('change', () => apply('enabled', enabled.checked));
    color.addEventListener('input', () => apply('color', color.value));
    intensity.addEventListener('input', () => {
      // A cleared or mistyped number field reads as '' (Number('') === 0): ignore it rather than zeroing the light.
      if (intensity.value !== '') apply('intensity', Number(intensity.value));
    });
    for (const axis of LIGHT_AXES) {
      const input = axisInputs[axis];
      input.addEventListener('input', () => {
        if (input.value !== '') apply(axis, Number(input.value));
      });
    }
    refreshers.push(() => syncLights());
  }

  // Presets + JSON dump.
  const snapshot = (): Record<string, ParamValue> => {
    const out: Record<string, ParamValue> = {};
    for (const [path, param] of params) out[path] = param.get();
    return out;
  };
  const applyValues = (values: Record<string, unknown>): void => {
    for (const [path, value] of Object.entries(values)) {
      const param = params.get(path);
      if (!param) continue;
      if (param.kind === 'number' && typeof value === 'number') param.set(value);
      else if (param.kind === 'toggle' && typeof value === 'boolean') param.set(value);
      else if (param.kind === 'choice' && typeof value === 'string' && param.options.includes(value)) param.set(value);
    }
    refresh();
    changed();
  };
  const defaults = snapshot();

  const presetDetails = el('details', 'debug-menu__group');
  presetDetails.open = true;
  presetDetails.append(el('summary', undefined, 'Presets'));
  const presetBody = el('div', 'debug-menu__body');
  presetDetails.append(presetBody);
  root.append(presetDetails);
  const presetRow = el('div', 'debug-menu__actions');
  const jsonBox = el('textarea');
  jsonBox.readOnly = true;
  jsonBox.spellcheck = false;
  const presetButtons: Record<string, () => void> = {
    'Save preset': () => localStorage.setItem(PRESET_KEY, JSON.stringify(snapshot())),
    'Load preset': () => {
      const raw = localStorage.getItem(PRESET_KEY);
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') applyValues(parsed as Record<string, unknown>);
      } catch {
        localStorage.removeItem(PRESET_KEY);
      }
    },
    'Reset to defaults': () => applyValues(defaults),
    Copy: () => void navigator.clipboard?.writeText(jsonBox.value),
  };
  for (const [label, run] of Object.entries(presetButtons)) {
    const button = el('button', undefined, label);
    button.type = 'button';
    button.addEventListener('click', run);
    presetRow.append(button);
  }
  presetBody.append(presetRow, el('span', undefined, 'Current values'), jsonBox);

  function refresh(): void {
    for (const r of refreshers) r();
    jsonBox.value = JSON.stringify(snapshot(), null, 2);
  }

  const toggleButton = el('button', 'debug-menu__toggle', 'DEBUG');
  toggleButton.type = 'button';
  const toggle = (): void => {
    root.hidden = !root.hidden;
    if (!root.hidden) refresh();
  };
  toggleButton.addEventListener('click', toggle);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== '`' || e.repeat) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (!root.contains(target)) return;
    }
    e.preventDefault();
    toggle();
  };
  window.addEventListener('keydown', onKey);

  const timers = [
    window.setInterval(() => {
      if (!root.hidden) refresh();
    }, 500),
  ];
  if (controls.stats) {
    const stats = controls.stats;
    timers.push(
      window.setInterval(() => {
        if (!root.hidden) statsLine.textContent = stats();
      }, 250),
    );
  }

  host.append(root, toggleButton);
  refresh();
  return {
    element: root,
    toggle,
    refresh,
    dispose: () => {
      for (const timer of timers) window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      root.remove();
      toggleButton.remove();
    },
  };
}
