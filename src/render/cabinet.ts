import * as THREE from 'three';
import { BOARD, DISK, PEARL_RADIUS, PUSHER, SCRAPER_Z, TOWER, TRAY } from '../config';
import { DISK_ENTRY, GUTTER, GUTTER_END } from '../sim/pearlPath';
import {
  carpetTexture,
  circuitPanelTexture,
  diskFaceTexture,
  emblemTexture,
  logoTexture,
  paintSevenSegment,
  sideSignTexture,
  slotRowTexture,
  speakerMeshTexture,
  topperSignTexture,
} from './textures';

/**
 * Static station geometry modeled on the reference cabinet (frames in REQUIREMENTS.md): black circuit-art back panel,
 * chrome screw pegs over the LCD, gold-framed slot windows, yellow neon chevrons, mirror tray, clear LED tower with the
 * pocket-disk bowl at its foot, control deck, and the red jackpot counter + sign on top. Collision shapes live in
 * `sim/physics.ts`; this module only draws around them.
 */

export const BRAND = 'NEON REEF';
export const JACKPOT_DIGITS = 4;

const TOWER_LED_COUNT = 72;
const BOWL_LED_COUNT = 48;
const v3 = (p: { x: number; y: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

export interface Cabinet {
  pusher: THREE.Group;
  disk: THREE.Group;
  towerLeds: THREE.InstancedMesh;
  bowlLeds: THREE.InstancedMesh;
  chevrons: THREE.MeshStandardMaterial;
  deckStrip: THREE.MeshStandardMaterial;
  jackpot: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture };
}

export function buildCabinet(scene: THREE.Scene, pegs: readonly { x: number; y: number }[], lcd: THREE.Texture): Cabinet {
  const m = materials();
  const hw = TRAY.halfWidth;
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number, shadows = false): THREE.Mesh => {
    mesh.position.set(x, y, z);
    mesh.receiveShadow = shadows;
    scene.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const plane = (w: number, h: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

  // Room: carpet floor and a dark back wall with soft neon glows (reflected by the chrome via the environment map).
  const floor = add(plane(1600, 1600, new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 })), 0, -60, 0, true);
  floor.rotation.x = -Math.PI / 2;

  // Base and shell.
  const panelZ = BOARD.z - BOARD.gap / 2 - 2.2;
  // Base under the tray, split around an open gutter trough in front of the tray lip; the disk bowl and tower sit on
  // their own pedestals to the right (the bowl lower than the tray, as on the cabinet).
  const solid = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material): THREE.Mesh =>
    add(box(x1 - x0, y1 - y0, z1 - z0, mat), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, true);
  const baseX = [-hw - 24, hw + 14] as const;
  const gutterX = [-hw - 3, GUTTER_END.x + PEARL_RADIUS] as const;
  const gutterZ = [TRAY.front + 0.5, GUTTER.z + PEARL_RADIUS + 2] as const;
  solid(baseX[0], baseX[1], -60, -4, -47, gutterZ[0], m.blackGloss);
  solid(baseX[0], baseX[1], -60, -4, gutterZ[1], 35, m.blackGloss);
  solid(baseX[0], gutterX[0], -60, -4, gutterZ[0], gutterZ[1], m.blackGloss);
  solid(gutterX[1], baseX[1], -60, -4, gutterZ[0], gutterZ[1], m.blackGloss);
  solid(gutterX[0], gutterX[1], -60, GUTTER.y - PEARL_RADIUS, gutterZ[0], gutterZ[1], m.blackGloss);
  solid(baseX[0], baseX[1], -4, -2.2, -47, gutterZ[0], m.chrome);
  solid(baseX[0], baseX[1], -4, -2.2, gutterZ[1], 35, m.chrome);
  solid(TOWER.x - 18, TOWER.x + 18, -60, TOWER.baseY, TOWER.z - 15, TOWER.z + 15, m.blackGloss);
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 50, 112, 3), m.blackGloss), 0, 52, panelZ - 1.6);
  const panel = add(plane(2 * hw + 46, 110, new THREE.MeshStandardMaterial({ map: circuitPanelTexture(), roughness: 0.32, metalness: 0.45 })), 0, 52, panelZ);
  panel.receiveShadow = true;
  for (const side of [-1, 1]) {
    add(box(4, 112, 6, m.chrome), side * (hw + 25), 52, panelZ);
    const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 108, 12), m.cyanLight), side * (hw + 22.6), 52, panelZ + 3.4);
    pipe.castShadow = false;
  }

  // LCD with bezel; the pegs sit in front of it like the real screen.
  add(box(54, 32, 1.2, m.blackGloss), 0, 53, panelZ + 0.4);
  // Peak LCD white stays under the bloom threshold so the screen glows without blowing out.
  add(plane(50, 28.125, new THREE.MeshBasicMaterial({ map: lcd, color: '#dcdcdc', toneMapped: false })), 0, 53, panelZ + 1.05);

  // Logo, drop emblem, and DROP tag above the board.
  add(plane(52, 13, new THREE.MeshStandardMaterial({ map: logoTexture(BRAND), transparent: true, metalness: 0.6, roughness: 0.25 })), 0, 90, panelZ + 0.6);
  add(plane(13, 13, new THREE.MeshStandardMaterial({ map: emblemTexture(), transparent: true, metalness: 0.3, roughness: 0.2 })), 0, 102, panelZ + 0.6);

  // Acrylic front pane, chrome side rails of the board, screw pegs (shaft + hex head).
  const boardH = BOARD.top - BOARD.binFloor;
  const boardMid = (BOARD.top + BOARD.binFloor) / 2;
  add(box(2 * BOARD.halfWidth + 2, boardH, 0.6, m.acrylic), 0, boardMid, BOARD.z + BOARD.gap / 2 + 0.3);
  for (const side of [-1, 1]) add(box(1.2, boardH, BOARD.gap + 2, m.chrome), side * (BOARD.halfWidth + 0.6), boardMid, BOARD.z);
  const shaftLen = BOARD.gap / 2 + 0.3 - (panelZ - BOARD.z);
  const shafts = new THREE.InstancedMesh(new THREE.CylinderGeometry(BOARD.pegRadius, BOARD.pegRadius, shaftLen, 10), m.satin, pegs.length);
  const heads = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.05, 1.05, 0.9, 6), m.satin, pegs.length);
  const alongZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const mat4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  pegs.forEach((peg, i) => {
    shafts.setMatrixAt(i, mat4.compose(pos.set(peg.x, peg.y, panelZ + shaftLen / 2), alongZ, one));
    heads.setMatrixAt(i, mat4.compose(pos.set(peg.x, peg.y, BOARD.z + BOARD.gap / 2 + 0.9), alongZ, one));
  });
  scene.add(shafts, heads);

  // Slot window housing: textured front face only (BoxGeometry face order: +x, −x, +y, −y, +z, −z).
  const slotFace = new THREE.MeshBasicMaterial({ map: slotRowTexture(), toneMapped: false });
  const housingH = (2 * BOARD.halfWidth + 6) * (300 / 1792);
  add(box(2 * BOARD.halfWidth + 6, housingH, 6, [m.blackGloss, m.blackGloss, m.blackGloss, m.blackGloss, slotFace, m.blackGloss]), 0, BOARD.binFloor + housingH / 2 - 1.5, BOARD.z + BOARD.gap / 2 + 3);

  // Sloped plate from the slot row down to the scraper, carrying the yellow neon chevrons.
  const plateTop = new THREE.Vector3(0, BOARD.binFloor - 1.5, BOARD.z + BOARD.gap / 2 + 6);
  const plateBottom = new THREE.Vector3(0, PUSHER.height + 0.6, SCRAPER_Z - 0.6);
  const plateLen = plateTop.distanceTo(plateBottom);
  const slope = Math.atan2(plateTop.y - plateBottom.y, plateBottom.z - plateTop.z);
  const plate = add(box(2 * hw, 0.8, plateLen, m.blackGloss), 0, (plateTop.y + plateBottom.y) / 2, (plateTop.z + plateBottom.z) / 2);
  plate.rotation.x = slope;
  const chevronMat = new THREE.MeshStandardMaterial({ color: '#ffd400', emissive: '#ffcc00', emissiveIntensity: 2.4 });
  for (const side of [-1, 1]) {
    // "‾\_" shape on the left, mirrored on the right (reference: short_09, demo_33).
    const pts = [
      [hw - 2, 0.15],
      [hw - 14, 0.15],
      [hw - 22, 0.75],
      [hw - 27, 0.75],
    ].map(([x, t]) => new THREE.Vector3(side * x!, 0, 0).add(plateTop.clone().lerp(plateBottom, t!)).add(new THREE.Vector3(0, 0.7, 0)));
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, 48, 0.55, 8, false), chevronMat));
  }

  // Tray: mirror floor, rounded chrome front lip, acrylic walls, low rails, scraper.
  add(box(2 * hw, 2, TRAY.front - TRAY.floorBack, m.mirror), 0, -1, (TRAY.front + TRAY.floorBack) / 2, true);
  const lip = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2 * hw, 16), m.chrome), 0, -0.6, TRAY.front);
  lip.rotation.z = Math.PI / 2;
  const railFront = TRAY.front - TRAY.openCorner;
  for (const side of [-1, 1]) {
    add(box(1, 24, -2 - TRAY.floorBack, m.acrylic), side * (hw + 0.5), 12, (TRAY.floorBack - 2) / 2);
    add(box(0.8, TRAY.railHeight, railFront + 2, m.chrome), side * (hw + 0.4), TRAY.railHeight / 2, (railFront - 2) / 2);
    const sign = add(plane(16, 16, new THREE.MeshStandardMaterial({ map: sideSignTexture(side < 0 ? 'PEARL' : 'BIG\nPEARL', side < 0 ? 'right' : 'left'), roughness: 0.2, transparent: true })), side * (hw + 6), 10, -8);
    sign.rotation.y = -side * 0.5;
  }
  add(box(2 * hw, 20, 0.6, m.acrylic), 0, PUSHER.height + 10.3, SCRAPER_Z - 0.3);

  const pusher = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(2 * hw - 0.1, PUSHER.height, PUSHER.depth), m.chrome);
  block.castShadow = block.receiveShadow = true;
  pusher.add(block);
  pusher.position.y = PUSHER.height / 2;
  scene.add(pusher);

  // Pocket disk in a clear bowl with an LED ring, under the tower.
  const disk = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(DISK.radius, 64),
    (() => {
      const map = diskFaceTexture();
      return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.35 });
    })(),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = 1.01;
  face.receiveShadow = true;
  const diskBase = new THREE.Mesh(new THREE.CylinderGeometry(DISK.radius, DISK.radius, 1.8, 64), m.blackGloss);
  diskBase.position.y = -0.1;
  disk.add(diskBase, face);
  disk.position.set(DISK.center.x, DISK.center.y, DISK.center.z);
  scene.add(disk);
  add(new THREE.Mesh(new THREE.CylinderGeometry(DISK.radius + 2.5, DISK.radius + 2.5, 7, 64, 1, true), m.acrylicDouble), DISK.center.x, DISK.center.y + 2.5, DISK.center.z);
  solid(DISK.center.x - 18, DISK.center.x + 18, -60, DISK.center.y - 1, DISK.center.z - 18, DISK.center.z + 18, m.blackGloss);
  const bowlLeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), m.led, BOWL_LED_COUNT);
  for (let i = 0; i < BOWL_LED_COUNT; i++) {
    const a = (i / BOWL_LED_COUNT) * Math.PI * 2;
    bowlLeds.setMatrixAt(i, mat4.compose(pos.set(DISK.center.x + (DISK.radius + 2.6) * Math.cos(a), DISK.center.y + 6, DISK.center.z + (DISK.radius + 2.6) * Math.sin(a)), new THREE.Quaternion(), one));
    bowlLeds.setColorAt(i, new THREE.Color('#40e8ff'));
  }
  scene.add(bowlLeds);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(v3(GUTTER_END), v3(DISK_ENTRY)), 1, PEARL_RADIUS + 0.4, 16, false), m.acrylicDouble));

  // Tower: faceted clear prism with an LED dot strip on its front-left edge and colored light lines inside.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.radiusTop, TOWER.radiusBottom, TOWER.height, 6, 1, false), m.acrylicDouble);
  tower.position.set(TOWER.x, TOWER.baseY + TOWER.height / 2, TOWER.z);
  tower.renderOrder = 2;
  scene.add(tower);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tower.geometry), new THREE.LineBasicMaterial({ color: '#9feaff', transparent: true, opacity: 0.55 }));
  edges.position.copy(tower.position);
  scene.add(edges);
  for (const [dx, color] of [[-3, '#2f7bff'], [1, '#b54dff'], [4, '#3ff0ff']] as const) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, TOWER.height - 6, 6), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
    line.position.set(TOWER.x + dx, tower.position.y, TOWER.z + 2);
    scene.add(line);
  }
  const towerLeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 8, 6), m.led, TOWER_LED_COUNT);
  const edgeAngle = -Math.PI / 3; // CylinderGeometry vertex at x = r·sin θ, z = r·cos θ: front-left edge
  for (let i = 0; i < TOWER_LED_COUNT; i++) {
    const f = (i + 0.5) / TOWER_LED_COUNT;
    const r = THREE.MathUtils.lerp(TOWER.radiusBottom, TOWER.radiusTop, f) + 0.4;
    towerLeds.setMatrixAt(i, mat4.compose(pos.set(TOWER.x + r * Math.sin(edgeAngle), TOWER.baseY + f * TOWER.height, TOWER.z + r * Math.cos(edgeAngle)), new THREE.Quaternion(), one));
    towerLeds.setColorAt(i, new THREE.Color('#40e8ff'));
  }
  scene.add(towerLeds);
  // Lift shaft up the tower axis (the stack hangs from its top cap) and the release tube out to the tray.
  const shaftTop = TOWER.stackTopY + 1;
  add(new THREE.Mesh(new THREE.CylinderGeometry(PEARL_RADIUS + 0.8, PEARL_RADIUS + 0.8, shaftTop - TOWER.baseY, 16, 1, true), m.acrylicDouble), TOWER.x, (shaftTop + TOWER.baseY) / 2, TOWER.z);
  add(new THREE.Mesh(new THREE.CylinderGeometry(PEARL_RADIUS + 1.5, PEARL_RADIUS + 1.5, 1, 16), m.chrome), TOWER.x, shaftTop + 0.5, TOWER.z);
  const releaseFrom = new THREE.Vector3(TOWER.x, TOWER.releaseTubeY, TOWER.z);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(releaseFrom, v3(TOWER.releaseExit)), 1, PEARL_RADIUS + 0.5, 16, false), m.acrylicDouble));

  // Control deck: slanted black panel, hex speaker grilles, two glowing launch buttons, white LED edge.
  const deck = new THREE.Group();
  deck.position.set(0, -4, TRAY.front + 16);
  deck.rotation.x = 0.2;
  scene.add(deck);
  // Narrower than the base so it never hides the (lower) pocket-disk bowl at the front-right.
  const deckWidth = 2 * (DISK.center.x - DISK.radius - 4);
  const deckTop = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, 2.5, 20), m.blackGloss);
  deckTop.receiveShadow = true;
  deck.add(deckTop);
  const grilleMat = new THREE.MeshStandardMaterial({ map: speakerMeshTexture(), roughness: 0.6, metalness: 0.5 });
  for (const x of [-26, 26]) {
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(26, 12), grilleMat);
    grille.rotation.x = -Math.PI / 2;
    grille.position.set(x, 1.3, 1);
    deck.add(grille);
  }
  for (const x of [-deckWidth / 2 + 7, deckWidth / 2 - 7]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.blueButton);
    button.position.set(x, 1.2, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.5, 8, 32), m.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 1.3, 0);
    deck.add(button, ring);
  }
  const deckStrip = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 2 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, 0.6, 0.6), deckStrip);
  strip.position.set(0, -1, 10.2);
  deck.add(strip);

  // Topper: red seven-segment jackpot counter on a black box, tilted magenta sign beside it.
  const segCanvas = document.createElement('canvas');
  segCanvas.width = 1024;
  segCanvas.height = 320;
  const segCtx = segCanvas.getContext('2d')!;
  paintSevenSegment(segCtx, 0, JACKPOT_DIGITS);
  const segTex = new THREE.CanvasTexture(segCanvas);
  segTex.colorSpace = THREE.SRGBColorSpace;
  add(box(46, 17, 8, m.blackGloss), -16, 117, panelZ - 2);
  add(plane(42, 13.1, new THREE.MeshBasicMaterial({ map: segTex, toneMapped: false })), -16, 117, panelZ + 2.05);
  const sign = add(plane(46, 23, new THREE.MeshStandardMaterial({ map: topperSignTexture(), transparent: true, roughness: 0.4 })), 30, 120, panelZ + 3);
  sign.rotation.set(0.12, -0.18, 0.05);

  return {
    pusher,
    disk,
    towerLeds,
    bowlLeds,
    chevrons: chevronMat,
    deckStrip,
    jackpot: { ctx: segCtx, texture: segTex },
  };
}

function materials() {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: '#dfe5ee', metalness: 1, roughness: 0.16 }),
    /** Brushed screw finish: mirror chrome on dozens of small pegs bloomed into a glare patch over the LCD. */
    satin: new THREE.MeshStandardMaterial({ color: '#b9c1cc', metalness: 1, roughness: 0.42 }),
    mirror: new THREE.MeshStandardMaterial({ color: '#c9d0da', metalness: 1, roughness: 0.07 }),
    blackGloss: new THREE.MeshStandardMaterial({ color: '#0b0c12', metalness: 0.35, roughness: 0.22 }),
    acrylic: new THREE.MeshStandardMaterial({ color: '#d8f4ff', transparent: true, opacity: 0.07, roughness: 0.02, depthWrite: false }),
    acrylicDouble: new THREE.MeshStandardMaterial({ color: '#d8f4ff', transparent: true, opacity: 0.12, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide }),
    cyanLight: new THREE.MeshStandardMaterial({ color: '#40e8ff', emissive: '#40e8ff', emissiveIntensity: 1.3 }),
    led: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    blueButton: new THREE.MeshStandardMaterial({ color: '#4c7dff', emissive: '#2f5bff', emissiveIntensity: 1.6, roughness: 0.15 }),
  };
}
