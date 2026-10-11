import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BALL_RADIUS, BOARD, DISK, PEARL_RADIUS, PUSHER, SCRAPER_Z, SLOTS, TRAY } from '../config';
import type { GameRules } from '../rules/game';
import type { PocketDisk } from '../sim/disk';
import type { PhysicsWorld } from '../sim/physics';
import { LCD_SIZE, paintLcd } from './lcd';

const MAX_BALLS = 600;
const MAX_PEARLS = 48;
const POCKET_HEX = { green: '#2bd46a', red: '#e0334f', yellow: '#ffc21a' } as const;
const SLOT_LABEL = { ball: 'BALL', ticket: 'TICKET', lucky: 'BIG BALL\nLUCKY' } as const;
const CHUTE_START = new THREE.Vector3(TRAY.halfWidth - 2, -6, TRAY.front + 3);
const DISK_ENTRY = new THREE.Vector3(
  DISK.center.x + DISK.grooveRadius * Math.cos(DISK.entryAngle),
  DISK.center.y + 1 + PEARL_RADIUS,
  DISK.center.z - DISK.grooveRadius * Math.sin(DISK.entryAngle),
);
/** Half extents (cm) the camera must keep in view around its target, for any aspect ratio. */
const VIEW_HALF = { w: 70, h: 64 };

/** three.js view of one station. Reads physics, disk, and rules state; never mutates them. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);
  private readonly scene = new THREE.Scene();
  private readonly cameraTarget = new THREE.Vector3(10, 38, -6);
  private readonly balls: THREE.InstancedMesh;
  private readonly pearls: THREE.InstancedMesh;
  private readonly pusher: THREE.Group;
  private readonly diskGroup = new THREE.Group();
  private readonly aimMarker: THREE.Mesh;
  private readonly lcdCtx: CanvasRenderingContext2D;
  private readonly lcdTex: THREE.CanvasTexture;
  private lcdVersion = -1;
  private lcdSecond = -1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOARD.z);
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly container: HTMLElement, pegs: readonly { x: number; y: number }[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#05070d');
    this.scene.fog = new THREE.Fog('#05070d', 260, 520);
    this.camera.position.set(10, 80, 150);

    this.addLights();
    this.buildCabinet();
    this.buildBoard(pegs);

    const lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = LCD_SIZE.w;
    lcdCanvas.height = LCD_SIZE.h;
    this.lcdCtx = lcdCanvas.getContext('2d')!;
    this.lcdTex = new THREE.CanvasTexture(lcdCanvas);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    const lcdW = 2 * BOARD.halfWidth - 4;
    const lcd = new THREE.Mesh(
      new THREE.PlaneGeometry(lcdW, (lcdW * LCD_SIZE.h) / LCD_SIZE.w),
      new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }),
    );
    lcd.position.set(0, 55, BOARD.z - BOARD.gap / 2 - 1.6);
    this.scene.add(lcd);

    this.pusher = new THREE.Group();
    const chrome = new THREE.MeshStandardMaterial({ color: '#c8d2dc', metalness: 0.9, roughness: 0.25 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(2 * TRAY.halfWidth - 0.1, PUSHER.height, PUSHER.depth), chrome);
    block.castShadow = block.receiveShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2 * TRAY.halfWidth - 2, 1.2, 0.3),
      new THREE.MeshStandardMaterial({ color: '#ffd400', emissive: '#ffd400', emissiveIntensity: 1.5 }),
    );
    stripe.position.set(0, 1.2, PUSHER.depth / 2 + 0.16);
    this.pusher.add(block, stripe);
    this.pusher.position.y = PUSHER.height / 2;
    this.scene.add(this.pusher);

    this.balls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
      new THREE.MeshStandardMaterial({ color: '#f5f3ea', roughness: 0.42 }),
      MAX_BALLS,
    );
    this.pearls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(PEARL_RADIUS, 32, 22),
      new THREE.MeshStandardMaterial({ color: '#ff8c1a', emissive: '#ff4d00', emissiveIntensity: 0.35, roughness: 0.12 }),
      MAX_PEARLS,
    );
    for (const mesh of [this.balls, this.pearls]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move every frame; the static bounding sphere would cull them wrongly
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
    }

    this.buildDisk();

    this.aimMarker = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 4, 16),
      new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffd400', emissiveIntensity: 2 }),
    );
    this.aimMarker.rotation.x = Math.PI;
    this.aimMarker.position.set(0, BOARD.top + 4, BOARD.z);
    this.scene.add(this.aimMarker);

    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    const dist = this.camera.position.distanceTo(this.cameraTarget);
    // Fit both extents: narrow screens are width-bound, wide screens height-bound.
    const half = Math.max(VIEW_HALF.h, VIEW_HALF.w / aspect);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(half / dist));
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  /** World x on the peg-board plane under a client point, or null if the ray misses it. */
  aimFromPointer(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.boardPlane, this.p);
    return hit ? hit.x : null;
  }

  sync(physics: PhysicsWorld, disk: PocketDisk, rules: GameRules, aimX: number): void {
    let balls = 0;
    let pearls = 0;
    for (const t of physics.bodies) {
      const pos = t.body.translation();
      const rot = t.body.rotation();
      this.m.compose(this.p.set(pos.x, pos.y, pos.z), this.q.set(rot.x, rot.y, rot.z, rot.w), this.one);
      if (t.kind === 'ball' && balls < MAX_BALLS) this.balls.setMatrixAt(balls++, this.m);
      else if (t.kind === 'pearl' && pearls < MAX_PEARLS) this.pearls.setMatrixAt(pearls++, this.m);
    }
    this.q.identity();
    for (const dp of disk.pearls) {
      if (pearls >= MAX_PEARLS) break;
      if (dp.chute > 0) {
        this.p.lerpVectors(CHUTE_START, DISK_ENTRY, 1 - dp.chute / DISK.chuteSeconds);
      } else {
        const sink = dp.pocket === null ? 0 : Math.min(dp.sunk * 10, PEARL_RADIUS * 1.3);
        this.p.set(
          DISK.center.x + DISK.grooveRadius * Math.cos(dp.angle),
          DISK.center.y + 1 + PEARL_RADIUS - sink,
          DISK.center.z - DISK.grooveRadius * Math.sin(dp.angle),
        );
      }
      this.pearls.setMatrixAt(pearls++, this.m.compose(this.p, this.q, this.one));
    }
    this.balls.count = balls;
    this.pearls.count = pearls;
    this.balls.instanceMatrix.needsUpdate = true;
    this.pearls.instanceMatrix.needsUpdate = true;

    this.pusher.position.z = physics.pusherFront - PUSHER.depth / 2;
    this.diskGroup.rotation.y = disk.angle;
    this.aimMarker.position.x = aimX;

    const second = Math.floor(rules.now);
    const partyActive = rules.partyEnds.ball !== null || rules.partyEnds.ticket !== null;
    if (rules.version !== this.lcdVersion || (partyActive && second !== this.lcdSecond)) {
      paintLcd(this.lcdCtx, rules);
      this.lcdTex.needsUpdate = true;
      this.lcdVersion = rules.version;
      this.lcdSecond = second;
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight('#9fb8ff', '#1a1026', 0.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(-40, 140, 90);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = key.shadow.camera;
    s.left = -60;
    s.right = 60;
    s.top = 60;
    s.bottom = -60;
    s.near = 40;
    s.far = 320;
    key.shadow.bias = -0.0008;
    this.scene.add(key, key.target);
    for (const x of [-34, 34]) {
      const glow = new THREE.PointLight('#41e8ff', 900, 120, 2);
      glow.position.set(x, 40, -20);
      this.scene.add(glow);
    }
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private buildCabinet(): void {
    const dark = new THREE.MeshStandardMaterial({ color: '#141824', metalness: 0.6, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: '#b9c3cf', metalness: 0.85, roughness: 0.3 });
    const acrylic = new THREE.MeshStandardMaterial({ color: '#bfefff', transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false });
    const hw = TRAY.halfWidth;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#0b0d14', roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -60;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.box(2 * hw + 20, 58, 70, dark, 0, -31, -1); // base
    this.box(2 * hw, 2, TRAY.front - TRAY.floorBack, steel, 0, -1, (TRAY.front + TRAY.floorBack) / 2).castShadow = false;
    this.box(30, 54, 36, dark, DISK.center.x, DISK.center.y - 28, DISK.center.z); // disk pedestal
    this.box(2 * hw + 24, 110, 4, dark, 0, 42, BOARD.z - BOARD.gap / 2 - 6); // backboard

    const tallBack = TRAY.floorBack;
    const tallFront = -2;
    const railFront = TRAY.front - TRAY.openCorner;
    for (const side of [-1, 1]) {
      this.box(1, 24, tallFront - tallBack, acrylic, side * (hw + 0.5), 12, (tallFront + tallBack) / 2);
      this.box(0.8, TRAY.railHeight, railFront - tallFront, steel, side * (hw + 0.4), TRAY.railHeight / 2, (railFront + tallFront) / 2);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 92, 16),
        new THREE.MeshStandardMaterial({ color: '#41e8ff', emissive: '#41e8ff', emissiveIntensity: 2.4 }),
      );
      pillar.position.set(side * (hw + 7), 40, BOARD.z + 4);
      this.scene.add(pillar);
    }
    this.box(2 * hw, 20, 0.6, acrylic, 0, PUSHER.height + 10.3, SCRAPER_Z - 0.3);

    // Front control deck with two decorative launch buttons.
    const deck = this.box(2 * hw + 20, 3, 16, dark, 0, -4, TRAY.front + 14);
    deck.rotation.x = 0.18;
    for (const x of [-14, 14]) {
      const button = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, 1.6, 24),
        new THREE.MeshStandardMaterial({ color: '#3f6bff', emissive: '#2a52ff', emissiveIntensity: 1.2 }),
      );
      button.position.set(x, -1.8, TRAY.front + 15);
      button.rotation.x = 0.18;
      this.scene.add(button);
    }

    const marquee = document.createElement('canvas');
    marquee.width = 1024;
    marquee.height = 160;
    const mctx = marquee.getContext('2d')!;
    const grad = mctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, '#41e8ff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#ff6ad5');
    mctx.fillStyle = grad;
    mctx.font = 'italic 900 112px system-ui, sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillText('NEON REEF', 512, 84);
    const mtex = new THREE.CanvasTexture(marquee);
    mtex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(56, 8.75), new THREE.MeshBasicMaterial({ map: mtex, transparent: true, toneMapped: false }));
    sign.position.set(0, BOARD.top + 9, BOARD.z + 3);
    this.scene.add(sign);
  }

  private buildBoard(pegs: readonly { x: number; y: number }[]): void {
    const acrylic = new THREE.MeshStandardMaterial({ color: '#d9f6ff', transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false });
    const steel = new THREE.MeshStandardMaterial({ color: '#d0d8e2', metalness: 0.95, roughness: 0.2 });
    const hw = BOARD.halfWidth;
    const height = BOARD.top - BOARD.binFloor;
    const midY = (BOARD.top + BOARD.binFloor) / 2;
    this.box(2 * hw + 2, height, 0.6, acrylic, 0, midY, BOARD.z + BOARD.gap / 2 + 0.3); // front pane
    for (const side of [-1, 1]) this.box(1, height, BOARD.gap + 2, steel, side * (hw + 0.5), midY, BOARD.z);
    this.box(2 * hw + 2, 1, BOARD.gap + 2, steel, 0, BOARD.binFloor - 0.5, BOARD.z);

    const slotWidth = (2 * hw) / SLOTS.length;
    const binH = BOARD.binTop - BOARD.binFloor;
    for (let i = 1; i < SLOTS.length; i++) this.box(0.6, binH, BOARD.gap, steel, -hw + i * slotWidth, BOARD.binFloor + binH / 2, BOARD.z);

    const pegMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(BOARD.pegRadius, BOARD.pegRadius, BOARD.gap + 3, 10), steel, pegs.length);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    pegs.forEach((peg, i) => pegMesh.setMatrixAt(i, this.m.compose(this.p.set(peg.x, peg.y, BOARD.z + 1.5), rot, this.one)));
    this.scene.add(pegMesh);

    // Slot badges printed on the front pane below the bins' mouths.
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0716';
    ctx.fillRect(0, 0, 1400, 200);
    SLOTS.forEach((kind, i) => {
      const cx = (i + 0.5) * 200;
      ctx.beginPath();
      ctx.arc(cx, 100, 80, 0, Math.PI * 2);
      ctx.fillStyle = kind === 'ball' ? '#4b6bff' : kind === 'ticket' ? '#8a3bd8' : '#1a2a8a';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#d8b44a';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = SLOT_LABEL[kind].split('\n');
      ctx.font = `900 ${lines.length > 1 ? 34 : 40}px system-ui, sans-serif`;
      lines.forEach((line, j) => ctx.fillText(line, cx, 100 + (j - (lines.length - 1) / 2) * 38));
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, binH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, toneMapped: false }));
    labels.position.set(0, BOARD.binFloor + binH / 2, BOARD.z + BOARD.gap / 2 + 0.7);
    this.scene.add(labels);
  }

  private buildDisk(): void {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const spacing = (Math.PI * 2) / DISK.pockets.length;
    const px = c / DISK.radius; // canvas pixels per cm
    DISK.pockets.forEach((color, k) => {
      // Texture v runs up while canvas y runs down, hence the negated angle; see the angle convention in sync().
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, -(k * spacing + spacing / 2), -(k * spacing - spacing / 2));
      ctx.closePath();
      ctx.fillStyle = POCKET_HEX[color];
      ctx.fill();
    });
    DISK.pockets.forEach((_, k) => {
      ctx.beginPath();
      ctx.arc(c + DISK.grooveRadius * px * Math.cos(k * spacing), c - DISK.grooveRadius * px * Math.sin(k * spacing), DISK.holeRadius * px, 0, Math.PI * 2);
      ctx.fillStyle = '#050208';
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(c, c, 3.5 * px, 0, Math.PI * 2);
    ctx.fillStyle = '#10142a';
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(DISK.radius, 64),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.3 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 1.01;
    top.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(DISK.radius, DISK.radius, 2, 64), new THREE.MeshStandardMaterial({ color: '#1b2030', metalness: 0.7, roughness: 0.4 }));
    this.diskGroup.add(base, top);
    this.diskGroup.position.set(DISK.center.x, DISK.center.y, DISK.center.z);
    this.scene.add(this.diskGroup);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(DISK.radius + 1, 1, 12, 64),
      new THREE.MeshStandardMaterial({ color: '#41e8ff', emissive: '#41e8ff', emissiveIntensity: 1.8 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(DISK.center.x, DISK.center.y + 1.5, DISK.center.z);
    this.scene.add(rim);

    const chute = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(CHUTE_START, DISK_ENTRY), 1, PEARL_RADIUS + 0.8, 16, false),
      new THREE.MeshStandardMaterial({ color: '#d9f6ff', transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.scene.add(chute);
  }
}
