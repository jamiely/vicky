import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BALL_RADIUS, DISK, PEARL_RADIUS, PUSHER } from '../config';
import type { GameRules } from '../rules/game';
import type { DiskPearl, PocketDisk } from '../sim/disk';
import { chutePoint, groovePoint, liftPoint, releasePoint, sinkDepth, stackPoint, stackY } from '../sim/pearlPath';
import type { PhysicsWorld } from '../sim/physics';
import type { DebugLightInfo, DebugLights } from '../ui/debugMenu';
import { buildCabinet, JACKPOT_DIGITS, type Cabinet } from './cabinet';
import { LCD_SIZE, paintLcd, type LcdFlash } from './lcd';
import { DEFAULT_DISTANCE, VIEW } from './settings';
import { paintSevenSegment } from './textures';

const MAX_BALLS = 600;
const MAX_PEARLS = 48;
/** Half width (cm) that must stay visible at the default distance; narrow screens scale the camera distance up. */
const FIT_HALF_WIDTH = 72;
const LCD_FPS = 20;

interface RegisteredLight {
  id: string;
  name: string;
  light: THREE.Light;
}

/** three.js view of one station. Reads physics, disk, and rules state; never mutates them. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(VIEW.camera.fov, 1, 10, 3000);
  readonly orbit: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cabinet: Cabinet;
  private readonly balls: THREE.InstancedMesh;
  private readonly pearls: THREE.InstancedMesh;
  private readonly lcdCtx: CanvasRenderingContext2D;
  private readonly lcdTex: THREE.CanvasTexture;
  private lcdNext = 0;
  private jackpotShown = -1;
  private flashState: LcdFlash | null = null;
  /** Pearls drawn last frame across tray, chute, disk, lift, and tower (diagnostics; pearls must never vanish). */
  pearlsDrawn = 0;
  private readonly lights: RegisteredLight[] = [];
  private readonly lightMarker: THREE.Mesh;
  private selectedLight: string | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color();

  constructor(private readonly container: HTMLElement, pegs: readonly { x: number; y: number }[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.environment = this.buildEnvironment();
    this.scene.background = new THREE.Color('#05050a');
    this.scene.fog = new THREE.Fog('#05050a', 420, 900);

    const lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = LCD_SIZE.w;
    lcdCanvas.height = LCD_SIZE.h;
    this.lcdCtx = lcdCanvas.getContext('2d')!;
    this.lcdTex = new THREE.CanvasTexture(lcdCanvas);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    this.lcdTex.anisotropy = 8;

    this.addLights();
    this.cabinet = buildCabinet(this.scene, pegs, this.lcdTex);

    this.balls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: '#f7f6f0', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: '#ffffff' }),
      MAX_BALLS,
    );
    this.pearls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(PEARL_RADIUS, 40, 28),
      new THREE.MeshPhysicalMaterial({ color: '#ff8616', emissive: '#ff4a00', emissiveIntensity: 0.45, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.2 }),
      MAX_PEARLS,
    );
    for (const mesh of [this.balls, this.pearls]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move every frame; the static bounding sphere would cull them wrongly
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
    }

    this.lightMarker = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff00ff', wireframe: true }));
    this.lightMarker.visible = false;
    this.scene.add(this.lightMarker);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), VIEW.render.bloomStrength, VIEW.render.bloomRadius, VIEW.render.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enabled = false;
    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
  }

  /** Shows a celebration overlay on the LCD (jackpot, party start, lucky pearl). */
  flash(kind: LcdFlash['kind'], amount: number): void {
    this.flashState = { kind, amount, age: 0 };
  }

  update(physics: PhysicsWorld, disk: PocketDisk, rules: GameRules, time: number, dt: number): void {
    this.applyView();
    this.syncBodies(physics, disk, rules);
    this.cabinet.pusher.position.z = physics.pusherFront - PUSHER.depth / 2;
    this.cabinet.disk.rotation.y = disk.angle;
    this.animateLeds(rules, time);

    if (this.flashState) {
      this.flashState.age += dt;
      if (this.flashState.age > 3.5) this.flashState = null;
    }
    if (time >= this.lcdNext) {
      this.lcdNext = time + 1 / LCD_FPS;
      paintLcd(this.lcdCtx, rules, time, this.flashState);
      this.lcdTex.needsUpdate = true;
    }
    if (rules.jackpot !== this.jackpotShown) {
      this.jackpotShown = rules.jackpot;
      paintSevenSegment(this.cabinet.jackpot.ctx, rules.jackpot, JACKPOT_DIGITS);
      this.cabinet.jackpot.texture.needsUpdate = true;
    }
  }

  render(): void {
    if (VIEW.render.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Releases the GL context and removes the canvas (browsers cap live WebGL contexts). */
  dispose(): void {
    this.orbit.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** Light registry for the debug menu's lighting editor. */
  debugLights(): DebugLights {
    return {
      list: () => this.lights.map(({ id, name, light }) => lightInfo(id, name, light)),
      set: (id, key, value) => {
        const entry = this.lights.find((l) => l.id === id);
        if (!entry) return;
        const { light } = entry;
        if (key === 'enabled') light.visible = Boolean(value);
        else if (key === 'color') light.color.set(String(value));
        else if (key === 'intensity') light.intensity = Number(value);
        else light.position[key] = Number(value);
        if (this.selectedLight === id) this.lightMarker.position.copy(light.position);
      },
      add: (type) => {
        const light = type === 'point' ? new THREE.PointLight('#ffffff', 1, 160, 0) : new THREE.SpotLight('#ffffff', 2, 300, 0.5, 0.5, 0);
        light.position.set(0, 80, 60);
        if (light instanceof THREE.SpotLight) this.scene.add(light.target);
        this.registerLight(`Custom ${type} ${this.lights.length + 1}`, light);
      },
      select: (id) => {
        this.selectedLight = id;
        const entry = this.lights.find((l) => l.id === id);
        this.lightMarker.visible = Boolean(entry && !(entry.light instanceof THREE.AmbientLight || entry.light instanceof THREE.HemisphereLight));
        if (entry) this.lightMarker.position.copy(entry.light.position);
      },
    };
  }

  private applyView(): void {
    const c = VIEW.camera;
    this.orbit.enabled = c.orbit;
    if (!c.orbit) {
      // Narrow (portrait) screens scale the distance so the default view still fits the cabinet width; zoom still works.
      const hHalf = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * this.camera.aspect;
      const distance = c.distance * Math.max(1, FIT_HALF_WIDTH / hHalf / DEFAULT_DISTANCE);
      const pitch = THREE.MathUtils.degToRad(c.pitch);
      const yaw = THREE.MathUtils.degToRad(c.yaw);
      this.camera.position.set(
        c.targetX + distance * Math.cos(pitch) * Math.sin(yaw),
        c.targetY + distance * Math.sin(pitch),
        c.targetZ + distance * Math.cos(pitch) * Math.cos(yaw),
      );
      this.orbit.target.set(c.targetX, c.targetY, c.targetZ);
      this.camera.lookAt(this.orbit.target);
    } else {
      this.orbit.update();
    }
    if (this.camera.fov !== c.fov) this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();

    const r = VIEW.render;
    this.renderer.toneMappingExposure = r.exposure;
    this.bloom.strength = r.bloomStrength;
    this.bloom.radius = r.bloomRadius;
    this.bloom.threshold = r.bloomThreshold;
    this.renderer.shadowMap.enabled = r.shadows;
    this.scene.environmentIntensity = r.environment;
  }

  private syncBodies(physics: PhysicsWorld, disk: PocketDisk, rules: GameRules): void {
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
    // Lifting pearls queue up under the stack: the one closest to arriving takes the next free slot.
    const lifting = disk.pearls.filter((p) => p.phase === 'lift').sort((a, b) => b.t - a.t);
    const draw = (dp: DiskPearl): void => {
      const u = (seconds: number): number => Math.min(1, dp.t / seconds);
      switch (dp.phase) {
        case 'chute':
          chutePoint(dp.from, u(DISK.chuteSeconds), this.p);
          break;
        case 'rolling':
          groovePoint(dp.angle, 0, this.p);
          break;
        case 'sunk':
          groovePoint(dp.angle, sinkDepth(dp.t), this.p);
          break;
        case 'lift':
          liftPoint(dp.from, u(DISK.liftSeconds), stackY(rules.pearlReserve + lifting.indexOf(dp)), this.p);
          break;
        case 'release':
          releasePoint(dp.slot, u(DISK.releaseSeconds), this.p);
          break;
      }
    };
    for (const dp of disk.pearls) {
      if (pearls >= MAX_PEARLS) break;
      draw(dp);
      this.pearls.setMatrixAt(pearls++, this.m.compose(this.p, this.q, this.one));
    }
    for (let i = 0; i < rules.pearlReserve && pearls < MAX_PEARLS; i++) {
      stackPoint(i, this.p);
      this.pearls.setMatrixAt(pearls++, this.m.compose(this.p, this.q, this.one));
    }
    this.balls.count = balls;
    this.pearls.count = pearls;
    this.pearlsDrawn = pearls;
    this.balls.instanceMatrix.needsUpdate = true;
    this.pearls.instanceMatrix.needsUpdate = true;
  }

  /** Tower chase, bowl rainbow ring, chevron pulse; parties speed everything up and go full rainbow. */
  private animateLeds(rules: GameRules, time: number): void {
    const ballParty = rules.partyEnds.ball !== null;
    const party = ballParty || rules.partyEnds.ticket !== null;
    const speed = VIEW.leds.speed * (party ? 3 : 1);
    const bright = VIEW.leds.brightness;
    const tower = this.cabinet.towerLeds;
    for (let i = 0; i < tower.count; i++) {
      const phase = (i / tower.count) * 6 - time * speed * 2.5;
      const head = 0.5 + 0.5 * Math.cos(phase * Math.PI);
      const level = 0.25 + 0.75 * head ** 6;
      if (party) this.color.setHSL((i / tower.count + time * 0.2) % 1, 1, 0.55);
      else this.color.set('#3ce6ff');
      tower.setColorAt(i, this.color.multiplyScalar(level * bright));
    }
    tower.instanceColor!.needsUpdate = true;
    const bowl = this.cabinet.bowlLeds;
    for (let i = 0; i < bowl.count; i++) {
      this.color.setHSL((i / bowl.count + time * 0.15 * speed) % 1, 0.95, 0.55);
      bowl.setColorAt(i, this.color.multiplyScalar(bright));
    }
    bowl.instanceColor!.needsUpdate = true;
    this.cabinet.chevrons.emissiveIntensity = (party ? 2 + 1.5 * Math.abs(Math.sin(time * 8)) : 2.2) * bright * 0.7;
    this.cabinet.deckStrip.emissiveIntensity = 0.5 * bright * (ballParty ? 0.7 + 0.5 * Math.abs(Math.sin(time * 6)) : 1);
  }

  private registerLight(name: string, light: THREE.Light): void {
    this.lights.push({ id: `light-${this.lights.length + 1}`, name, light });
    this.scene.add(light);
  }

  private addLights(): void {
    this.registerLight('Hemisphere', new THREE.HemisphereLight('#8fa6ff', '#140a20', 0.35));
    const key = new THREE.DirectionalLight('#fff4e6', 1.5);
    key.position.set(-30, 160, 90);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = key.shadow.camera;
    s.left = -60;
    s.right = 70;
    s.top = 70;
    s.bottom = -50;
    s.near = 40;
    s.far = 360;
    key.shadow.bias = -0.0008;
    this.scene.add(key.target);
    this.registerLight('Key (ceiling)', key);
    const lights: [string, string, number, number, [number, number, number]][] = [
      ['Tower glow', '#3ce6ff', 1.4, 90, [44, 40, 20]],
      ['LCD spill', '#c04dff', 0.35, 40, [0, 53, -20]],
      ['Tray fill', '#ffffff', 0.7, 120, [0, 32, 40]],
      ['Disk glow', '#ff3fa8', 0.9, 50, [44, 8, 30]],
    ];
    for (const [name, color, intensity, distance, [x, y, z]] of lights) {
      const light = new THREE.PointLight(color, intensity, distance, 0);
      light.position.set(x, y, z);
      this.registerLight(name, light);
    }
  }

  /** Arcade-room environment for chrome/acrylic reflections: dark hall, ceiling light strips, neon panels. */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(100, 40, 100), new THREE.MeshBasicMaterial({ color: '#0a0a12', side: THREE.BackSide })));
    const panel = (w: number, h: number, color: string, x: number, y: number, z: number, rx: number, ry: number): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, 0);
      env.add(mesh);
    };
    for (let i = -2; i <= 2; i++) panel(30, 2.2, '#fff6e8', 0, 19, i * 16, Math.PI / 2, 0);
    panel(30, 12, '#18d8ff', -49, 6, 0, 0, Math.PI / 2);
    panel(30, 12, '#ff2fa0', 49, 6, 0, 0, -Math.PI / 2);
    panel(40, 10, '#6a3bff', 0, 4, -49, 0, 0);
    panel(40, 8, '#ffb347', 0, 2, 49, 0, Math.PI);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const texture = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
    return texture;
  }
}

function lightInfo(id: string, name: string, light: THREE.Light): DebugLightInfo {
  const type =
    light instanceof THREE.HemisphereLight ? 'hemisphere'
    : light instanceof THREE.AmbientLight ? 'ambient'
    : light instanceof THREE.DirectionalLight ? 'directional'
    : light instanceof THREE.SpotLight ? 'spot'
    : 'point';
  return { id, name, type, enabled: light.visible, color: `#${light.color.getHexString()}`, intensity: light.intensity, x: light.position.x, y: light.position.y, z: light.position.z };
}
