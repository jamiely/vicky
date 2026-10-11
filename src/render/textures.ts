import * as THREE from 'three';
import { DISK, SLOTS, type PocketColor, type SlotKind } from '../config';

/**
 * Procedural canvas art for the cabinet, modeled on the reference footage (layout, palette, finish) without copying
 * its logos or character artwork. Every function returns a fresh sRGB texture; callers own disposal.
 */

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function texture(canvas: HTMLCanvasElement, anisotropy = 8): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Black back panel with mirrored silver circuit "wings" and red accent blocks (reference: short_09, demo_20). */
export function circuitPanelTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 2048;
  const { canvas, ctx } = canvas2d(W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#07080d');
  bg.addColorStop(1, '#0d0f16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Red accent slabs behind the wings, visible on the real cabinet's upper sides.
  ctx.fillStyle = '#7a0b16';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side < 0 ? 0 : W, 0);
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(0, 520);
    ctx.lineTo(170, 470);
    ctx.lineTo(210, 900);
    ctx.lineTo(0, 980);
    ctx.fill();
    ctx.restore();
  }

  // Silver circuit wings: bundles of parallel traces that sweep outward like feathers, mirrored left/right.
  const drawWing = (): void => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let feather = 0; feather < 5; feather++) {
      const y0 = 300 + feather * 300;
      for (let i = 0; i < 7; i++) {
        const o = i * 14;
        ctx.strokeStyle = i % 3 === 0 ? '#e9eef6' : '#9aa4b4';
        ctx.lineWidth = i % 3 === 0 ? 6 : 3.5;
        ctx.beginPath();
        ctx.moveTo(470 - o, y0 + o);
        ctx.lineTo(330 - o, y0 - 90 + o);
        ctx.lineTo(120 - o * 0.6, y0 - 90 + o);
        ctx.lineTo(40, y0 - 160 + o * 1.4);
        ctx.stroke();
      }
      ctx.fillStyle = '#d7dde8';
      ctx.beginPath();
      ctx.arc(470, y0, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    // Long vertical trace bundle hugging the board edge.
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = '#8a94a6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(520 + i * 12, 160);
      ctx.lineTo(520 + i * 12, 1880);
      ctx.stroke();
    }
  };
  drawWing();
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  drawWing();
  ctx.restore();

  // Faint central board grid behind the pegs.
  ctx.strokeStyle = 'rgba(120,140,200,0.07)';
  ctx.lineWidth = 2;
  for (let x = 600; x <= W - 600; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 200);
    ctx.lineTo(x, H - 200);
    ctx.stroke();
  }
  return texture(canvas);
}

/** Chrome italic wordmark in the cabinet's style (original name). */
export function logoTexture(text: string): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 256);
  const grad = ctx.createLinearGradient(0, 40, 0, 220);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#c9d1dc');
  grad.addColorStop(0.55, '#7d8796');
  grad.addColorStop(1, '#eef2f7');
  ctx.font = 'italic 900 150px "Arial Black", Impact, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#1b1f27';
  ctx.strokeText(text, 512, 132);
  ctx.fillStyle = grad;
  ctx.fillText(text, 512, 132);
  // Underline swoosh like the cabinet logo's tail.
  ctx.strokeStyle = '#d8dee8';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(150, 222);
  ctx.lineTo(880, 210);
  ctx.lineTo(930, 170);
  ctx.stroke();
  return texture(canvas);
}

/** Clear disc with a downward arrow marking where balls drop in, plus the red "DROP" tag. */
export function emblemTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  const c = 256;
  const ring = ctx.createRadialGradient(c, c, 150, c, c, 250);
  ring.addColorStop(0, 'rgba(30,34,48,0.2)');
  ring.addColorStop(0.8, 'rgba(200,210,230,0.55)');
  ring.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(c, c, 245, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8edf5';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(c - 40, 110);
  ctx.lineTo(c + 40, 110);
  ctx.lineTo(c + 40, 280);
  ctx.lineTo(c + 100, 280);
  ctx.lineTo(c, 410);
  ctx.lineTo(c - 100, 280);
  ctx.lineTo(c - 40, 280);
  ctx.closePath();
  ctx.stroke();
  return texture(canvas);
}

/** Seven slot windows in a black housing: gold frames around glossy glass badges (reference: slots crop). */
export function slotRowTexture(): THREE.CanvasTexture {
  const W = 1792;
  const H = 300;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.fillStyle = '#06070b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3b3f4a';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  const label: Record<SlotKind, string[]> = { ball: ['BALL'], ticket: ['TICKET'], lucky: ['BIG BALL', 'LUCKY'] };
  const cell = W / SLOTS.length;
  SLOTS.forEach((kind, i) => {
    const x = i * cell + 26;
    const w = cell - 52;
    roundRect(ctx, x, 44, w, 212, 26);
    ctx.fillStyle = '#0b0c12';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#c9a248';
    ctx.stroke();
    const glass = ctx.createRadialGradient(x + w * 0.35, 110, 10, x + w / 2, 150, w * 0.6);
    glass.addColorStop(0, kind === 'lucky' ? '#c7d3ff' : '#f0c8ff');
    glass.addColorStop(0.45, kind === 'lucky' ? '#4c63d8' : kind === 'ball' ? '#7a4be0' : '#a24fd0');
    glass.addColorStop(1, '#251a5c');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(x + w / 2, 150, w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = label[kind];
    ctx.font = `900 ${lines.length > 1 ? 38 : 46}px system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(40,0,80,0.9)';
    ctx.shadowBlur = 8;
    lines.forEach((line, j) => ctx.fillText(line, x + w / 2, 150 + (j - (lines.length - 1) / 2) * 42));
    ctx.shadowBlur = 0;
  });
  return texture(canvas);
}

/** Red seven-segment readout (the jackpot counter mounted above the station). Repaint in place on value change. */
export function paintSevenSegment(ctx: CanvasRenderingContext2D, value: number, digits: number): void {
  const { width: W, height: H } = ctx.canvas;
  ctx.fillStyle = '#0a0203';
  ctx.fillRect(0, 0, W, H);
  // Segment bitmasks: a b c d e f g (top, top-right, bottom-right, bottom, bottom-left, top-left, middle).
  const MASKS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
  const text = String(Math.max(0, Math.floor(value))).padStart(digits, ' ').slice(-digits);
  const cw = W / digits;
  const t = cw * 0.13; // segment thickness
  const sw = cw * 0.62;
  const sh = H * 0.36;
  [...text].forEach((ch, i) => {
    const mask = ch === ' ' ? 0 : MASKS[Number(ch)]!;
    const x0 = i * cw + (cw - sw) / 2 + cw * 0.04;
    const y0 = H * 0.12;
    const segs: [number, number, number, number][] = [
      [x0 + t, y0, sw - 2 * t, t],
      [x0 + sw - t, y0 + t, t, sh - t],
      [x0 + sw - t, y0 + sh + t, t, sh - t],
      [x0 + t, y0 + 2 * sh, sw - 2 * t, t],
      [x0, y0 + sh + t, t, sh - t],
      [x0, y0 + t, t, sh - t],
      [x0 + t, y0 + sh, sw - 2 * t, t],
    ];
    segs.forEach(([x, y, w, h], s) => {
      const on = (mask >> s) & 1;
      ctx.fillStyle = on ? '#ff2a1f' : '#2a0606';
      ctx.shadowColor = on ? '#ff3020' : 'transparent';
      ctx.shadowBlur = on ? 18 : 0;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.transform(1, 0, -0.08, 1, 0, 0); // slight italic slant like real LED digits
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    });
  });
  ctx.shadowBlur = 0;
}

/** Magenta topper sign with gold headline and numbered feature list (original wording). */
export function topperSignTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 512);
  const bg = ctx.createLinearGradient(0, 0, 1024, 512);
  bg.addColorStop(0, '#c2185b');
  bg.addColorStop(1, '#7b0d3e');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(30, 40);
  ctx.lineTo(1000, 10);
  ctx.lineTo(990, 470);
  ctx.lineTo(80, 500);
  ctx.lineTo(10, 300);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#f7d36a';
  ctx.stroke();
  ctx.save();
  ctx.translate(520, 120);
  ctx.rotate(-0.04);
  ctx.textAlign = 'center';
  ctx.font = 'italic 900 92px "Arial Black", Impact, sans-serif';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#3a0618';
  ctx.strokeText('PEARL JACKPOT', 0, 0);
  const gold = ctx.createLinearGradient(0, -60, 0, 20);
  gold.addColorStop(0, '#fff3b0');
  gold.addColorStop(1, '#f2b53a');
  ctx.fillStyle = gold;
  ctx.fillText('PEARL JACKPOT', 0, 0);
  ctx.restore();
  const lines = ['GROWING JACKPOT UP TO 9999', 'BALL & TICKET PARTY TIME', 'COLLECT BIG PEARLS TO WIN'];
  ctx.font = '800 46px system-ui, sans-serif';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    const y = 250 + i * 72;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(120, y - 14, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7b0d3e';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 120, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff6f0';
    ctx.fillText(line, 170, y);
  });
  return texture(canvas);
}

/** Acrylic side sign with glossy panel, label, and arrows (reference: "PEARL ←" / "BIG PEARL ←" signs by the tray). */
export function sideSignTexture(title: string, arrow: 'left' | 'right'): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  const bg = ctx.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#1d2a6b');
  bg.addColorStop(1, '#5a1f8f');
  roundRect(ctx, 16, 16, 480, 480, 40);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#9fd8ff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 92px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  title.split('\n').forEach((line, i, all) => ctx.fillText(line, 256, 200 + (i - (all.length - 1) / 2) * 96));
  ctx.fillStyle = '#ffd400';
  const dir = arrow === 'left' ? -1 : 1;
  for (const y of [360, 440]) {
    ctx.beginPath();
    ctx.moveTo(256 + dir * 120, y);
    ctx.lineTo(256 + dir * 40, y - 40);
    ctx.lineTo(256 + dir * 40, y - 16);
    ctx.lineTo(256 - dir * 110, y - 16);
    ctx.lineTo(256 - dir * 110, y + 16);
    ctx.lineTo(256 + dir * 40, y + 16);
    ctx.lineTo(256 + dir * 40, y + 40);
    ctx.closePath();
    ctx.fill();
  }
  return texture(canvas);
}

/** Hexagonal perforated speaker grille for the control deck. */
export function speakerMeshTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  ctx.fillStyle = '#1a1d24';
  ctx.fillRect(0, 0, 512, 512);
  const r = 9;
  const dx = r * 2.1;
  const dy = r * 1.82;
  for (let row = 0, y = r; y < 512 + r; row++, y += dy) {
    for (let x = row % 2 ? dx / 2 : 0; x < 512 + r; x += dx) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#040506';
      ctx.fill();
    }
  }
  const tex = texture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const POCKET_HEX: Record<PocketColor, string> = { green: '#1fd39a', red: '#ff2f7a', yellow: '#ffb21e' };

/**
 * Pocket disk face: saturated colored sectors with chrome-ringed holes and a dark center emblem (reference: tower_441).
 * Angle convention matches the stage: texture angle a ↔ local (cos a, −sin a) after the circle is laid flat.
 */
export function diskFaceTexture(): THREE.CanvasTexture {
  const size = 1024;
  const { canvas, ctx } = canvas2d(size, size);
  const c = size / 2;
  const spacing = (Math.PI * 2) / DISK.pockets.length;
  const px = c / DISK.radius;
  DISK.pockets.forEach((color, k) => {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, c, -(k * spacing + spacing / 2), -(k * spacing - spacing / 2));
    ctx.closePath();
    const g = ctx.createRadialGradient(c, c, c * 0.2, c, c, c);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, POCKET_HEX[color]);
    g.addColorStop(1, POCKET_HEX[color]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#0b0b12';
    ctx.lineWidth = 10;
    ctx.stroke();
  });
  DISK.pockets.forEach((_, k) => {
    const x = c + DISK.grooveRadius * px * Math.cos(k * spacing);
    const y = c - DISK.grooveRadius * px * Math.sin(k * spacing);
    const hole = ctx.createRadialGradient(x, y, 0, x, y, DISK.holeRadius * px);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(0.75, '#14141c');
    hole.addColorStop(1, '#5a5f6c');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(x, y, DISK.holeRadius * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#eef3fa';
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(c, c, 3.6 * px, 0, Math.PI * 2);
  ctx.fillStyle = '#0d1430';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#7fe8ff';
  ctx.stroke();
  ctx.fillStyle = '#bff6ff';
  ctx.font = 'italic 900 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PEARL', c, c);
  return texture(canvas);
}

/** Dark arcade carpet with scattered neon shapes. */
export function carpetTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  ctx.fillStyle = '#0c0b14';
  ctx.fillRect(0, 0, 512, 512);
  const colors = ['#2b1a55', '#13324a', '#3a1230', '#1f2a1a'];
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = colors[i % colors.length]!;
    ctx.lineWidth = 4;
    const x = rand() * 512;
    const y = rand() * 512;
    const s = 8 + rand() * 18;
    ctx.beginPath();
    if (i % 3 === 0) ctx.arc(x, y, s, 0, Math.PI * 2);
    else if (i % 3 === 1) ctx.rect(x, y, s, s);
    else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y + s * 0.6);
      ctx.lineTo(x - s * 0.3, y + s);
      ctx.closePath();
    }
    ctx.stroke();
  }
  const tex = texture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}
