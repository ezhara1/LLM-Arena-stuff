import * as THREE from 'three';
import './style.css';

const canvas = document.getElementById('game-canvas');
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
const gameOver = document.getElementById('game-over');
const restartButton = document.getElementById('restart-button');
const crosshair = document.getElementById('crosshair');
const radar = document.getElementById('radar');
const radarContext = radar.getContext('2d');
const damageFlash = document.getElementById('damage-flash');

let scene;
let renderer;
let camera;
let clock;
let audioContext;
let sunLight;
let player;
let aimMarker;
let aimTarget = new THREE.Vector3(0, 0, -40);
let groundPlane;
let worldInitialized = false;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();

const destructibles = [];
const enemies = [];
const projectiles = [];
const effects = [];
const keys = new Set();
let mouseDown = false;

const state = {
  started: false,
  gameOver: false,
  elapsed: 0,
  score: 0,
  totalHostiles: 9,
  destroyedHostiles: 0,
  resultQueued: false,
  screenShake: 0,
  currentSpeed: 0,
  lastClockText: '',
};

const WORLD_SIZE = 220;
const ARENA_LIMIT = 94;
const BLOCK_TYPES = {};
const textureCache = {};
let smokeTexture;

const ui = {
  clock: document.getElementById('clock'),
  armorValue: document.getElementById('armor-value'),
  armorFill: document.getElementById('armor-fill'),
  armorState: document.getElementById('armor-state'),
  weaponStatus: document.getElementById('weapon-status'),
  weaponFill: document.getElementById('weapon-fill'),
  ammoCount: document.getElementById('ammo-count'),
  objectiveTitle: document.getElementById('objective-title'),
  objectiveDetail: document.getElementById('objective-detail'),
  objectiveCount: document.getElementById('objective-count'),
  objectiveProgress: document.getElementById('objective-progress'),
  speed: document.getElementById('speed-value'),
  tankCount: document.getElementById('tank-count'),
  jeepCount: document.getElementById('jeep-count'),
  artilleryCount: document.getElementById('artillery-count'),
  eventFeed: document.getElementById('event-feed'),
  finalScore: document.getElementById('final-score'),
  gameOverTitle: document.getElementById('game-over-title'),
  gameOverDetail: document.getElementById('game-over-detail'),
};

const UNIT_STATS = {
  tank: {
    label: 'TANK',
    maxHealth: 430,
    speed: 4.5,
    radius: 3.0,
    range: 73,
    fireRate: 2.25,
    damage: 43,
    shellSpeed: 40,
    blastRadius: 3.8,
    score: 700,
    color: 0x9c5141,
    accent: 0xf2a37b,
  },
  jeep: {
    label: 'JEEP',
    maxHealth: 220,
    speed: 7.2,
    radius: 2.25,
    range: 58,
    fireRate: 1.7,
    damage: 28,
    shellSpeed: 45,
    blastRadius: 3.0,
    score: 350,
    color: 0xb16b3d,
    accent: 0xffc16d,
  },
  artillery: {
    label: 'ARTILLERY',
    maxHealth: 340,
    speed: 2.7,
    radius: 2.8,
    range: 102,
    fireRate: 3.4,
    damage: 53,
    shellSpeed: 31,
    blastRadius: 4.6,
    score: 850,
    color: 0x887454,
    accent: 0xe7c885,
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerpAngle(from, to, amount) {
  let difference = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference * amount;
}

function damp(current, target, smoothing, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * delta));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function formatScore(value) {
  return Math.round(value).toString().padStart(6, '0');
}

function createNoiseTexture(name, baseColor, accentColor, grid = false) {
  if (textureCache[name]) return textureCache[name];
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 512;
  textureCanvas.height = 512;
  const context = textureCanvas.getContext('2d');
  context.fillStyle = baseColor;
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 3400; i += 1) {
    const alpha = Math.random() * 0.15 + 0.025;
    context.fillStyle = `rgba(${accentColor},${alpha})`;
    const size = Math.random() * 4 + 1;
    context.fillRect(Math.random() * 512, Math.random() * 512, size, size * randomBetween(.35, 1.8));
  }
  if (grid) {
    context.strokeStyle = 'rgba(175, 201, 170, .10)';
    context.lineWidth = 1;
    for (let x = 0; x <= 512; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 512);
      context.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(512, y);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textureCache[name] = texture;
  return texture;
}

function createSmokeTexture() {
  if (smokeTexture) return smokeTexture;
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = 128;
  smokeCanvas.height = 128;
  const context = smokeCanvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 60);
  gradient.addColorStop(0, 'rgba(218, 229, 196, .54)');
  gradient.addColorStop(.35, 'rgba(128, 145, 123, .29)');
  gradient.addColorStop(1, 'rgba(70, 82, 69, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  smokeTexture = new THREE.CanvasTexture(smokeCanvas);
  smokeTexture.colorSpace = THREE.SRGBColorSpace;
  return smokeTexture;
}

function createMaterials() {
  const concreteTexture = createNoiseTexture('concrete', '#59645b', '210,225,195', false);
  const brickTexture = createNoiseTexture('brick', '#674d40', '234,191,143', true);
  const crateTexture = createNoiseTexture('crate', '#765f3d', '232,199,128', false);
  const metalTexture = createNoiseTexture('metal', '#3f5045', '195,221,175', false);
  const groundTexture = createNoiseTexture('ground', '#18231b', '150,182,137', true);
  groundTexture.repeat.set(7, 7);
  BLOCK_TYPES.concrete = new THREE.MeshStandardMaterial({ color: 0xaeb8a5, map: concreteTexture, roughness: .93, metalness: .02 });
  BLOCK_TYPES.brick = new THREE.MeshStandardMaterial({ color: 0x9c6751, map: brickTexture, roughness: .92, metalness: .03 });
  BLOCK_TYPES.crate = new THREE.MeshStandardMaterial({ color: 0x9a7a4c, map: crateTexture, roughness: .88, metalness: .05 });
  BLOCK_TYPES.metal = new THREE.MeshStandardMaterial({ color: 0x6e8972, map: metalTexture, roughness: .68, metalness: .36 });
  return { groundTexture };
}

function addBox(parent, size, position, material, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRoad(x, z, width, length, rotation = 0) {
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d2920,
    roughness: 1,
    transparent: true,
    opacity: .86,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(width, length), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = rotation;
  road.position.set(x, .012, z);
  road.receiveShadow = true;
  scene.add(road);
  const centerLineMaterial = new THREE.MeshBasicMaterial({ color: 0x61745a, transparent: true, opacity: .17 });
  for (let i = -length / 2 + 5; i < length / 2; i += 10) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width * .06, 4), centerLineMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.rotation.z = rotation;
    const direction = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation));
    stripe.position.set(x + direction.x * i, .018, z + direction.z * i);
    scene.add(stripe);
  }
}

function addDestructibleBlock(position, size, type = 'concrete', health = 230) {
  const material = BLOCK_TYPES[type].clone();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.isDestructible = true;
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const block = {
    mesh,
    size: new THREE.Vector3(size[0], size[1], size[2]),
    box,
    type,
    health,
    maxHealth: health,
    active: true,
    damaged: false,
  };
  mesh.userData.block = block;
  destructibles.push(block);
  return block;
}

function buildStructure(centerX, centerZ, width, depth, levels, type = 'concrete', doorway = false) {
  const blockWidth = 4;
  const blockHeight = 3.1;
  const frontCount = Math.max(2, Math.floor(width / blockWidth));
  const sideCount = Math.max(2, Math.floor(depth / blockWidth));
  const frontStep = width / frontCount;
  const sideStep = depth / sideCount;
  for (let level = 0; level < levels; level += 1) {
    for (let i = 0; i < frontCount; i += 1) {
      const x = centerX - width / 2 + frontStep * (i + .5);
      const skipDoor = doorway && level === 0 && i >= Math.floor(frontCount / 2) - 1 && i <= Math.floor(frontCount / 2);
      if (!skipDoor) {
        addDestructibleBlock([x, blockHeight * (level + .5), centerZ - depth / 2], [frontStep + .08, blockHeight, .92], type, type === 'brick' ? 180 : 245);
        addDestructibleBlock([x, blockHeight * (level + .5), centerZ + depth / 2], [frontStep + .08, blockHeight, .92], type, type === 'brick' ? 180 : 245);
      }
    }
    for (let i = 0; i < sideCount; i += 1) {
      const z = centerZ - depth / 2 + sideStep * (i + .5);
      addDestructibleBlock([centerX - width / 2, blockHeight * (level + .5), z], [.92, blockHeight, sideStep + .08], type, type === 'brick' ? 180 : 245);
      addDestructibleBlock([centerX + width / 2, blockHeight * (level + .5), z], [.92, blockHeight, sideStep + .08], type, type === 'brick' ? 180 : 245);
    }
  }
  const roofRows = Math.max(2, Math.floor(width / 5));
  const roofCols = Math.max(2, Math.floor(depth / 5));
  for (let x = 0; x < roofRows; x += 1) {
    for (let z = 0; z < roofCols; z += 1) {
      addDestructibleBlock([
        centerX - width / 2 + (x + .5) * width / roofRows,
        blockHeight * levels + .45,
        centerZ - depth / 2 + (z + .5) * depth / roofCols,
      ], [width / roofRows + .08, .9, depth / roofCols + .08], 'concrete', 260);
    }
  }
}

function buildBarrier(x, z, count, alongX = true, levels = 1, type = 'concrete') {
  for (let i = 0; i < count; i += 1) {
    for (let level = 0; level < levels; level += 1) {
      const offset = (i - (count - 1) / 2) * 3.9;
      addDestructibleBlock([
        x + (alongX ? offset : 0),
        1.05 + level * 2.0,
        z + (alongX ? 0 : offset),
      ], alongX ? [3.7, 2, 2.2] : [2.2, 2, 3.7], type, 160);
    }
  }
}

function buildCrateStack(x, z, columns, rows) {
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows - (column % 2 === 0 ? 0 : 1); row += 1) {
      const px = x + (column - (columns - 1) / 2) * 2.35;
      const pz = z + ((row % 2) * .12);
      addDestructibleBlock([px, .95 + row * 1.9, pz], [2.15, 1.8, 2.15], 'crate', 95);
    }
  }
}

function buildWorld() {
  const materials = createMaterials();
  scene.background = new THREE.Color(0x0b1510);
  scene.fog = new THREE.FogExp2(0x0b1510, .0094);
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x556651, map: materials.groundTexture, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD_SIZE, 44, 0x52664e, 0x29392c);
  grid.position.y = .035;
  grid.material.transparent = true;
  grid.material.opacity = .16;
  scene.add(grid);

  addRoad(0, 0, 13, WORLD_SIZE * .92, 0);
  addRoad(0, 0, WORLD_SIZE * .92, 13, Math.PI / 2);
  addRoad(-41, 18, 8, 65, Math.PI / 2);
  addRoad(42, -27, 8, 54, Math.PI / 2);

  // The yard is intentionally made from individual blocks. Every wall, roof, crate and barrier has its own health.
  buildStructure(-51, -39, 31, 26, 3, 'concrete', true);
  buildStructure(45, -39, 25, 21, 2, 'brick', true);
  buildStructure(-51, 38, 29, 18, 2, 'brick', false);
  buildStructure(48, 35, 31, 24, 3, 'concrete', true);

  buildBarrier(-4, -15, 7, true, 1, 'concrete');
  buildBarrier(17, 17, 5, false, 2, 'concrete');
  buildBarrier(-30, 10, 6, true, 1, 'metal');
  buildBarrier(26, -1, 4, true, 1, 'concrete');
  buildBarrier(-8, 49, 5, true, 2, 'brick');

  buildCrateStack(28, -20, 4, 3);
  buildCrateStack(-19, -32, 3, 2);
  buildCrateStack(31, 45, 3, 3);
  buildCrateStack(-23, 47, 4, 2);

  // Low piles make the empty sections feel like a used industrial yard without blocking the sight lines.
  for (let i = 0; i < 22; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = randomBetween(54, 88);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.abs(x) < 35 && Math.abs(z) < 32) continue;
    const size = randomBetween(1.2, 2.4);
    addDestructibleBlock([x, size * .35, z], [size * 1.5, size * .7, size], Math.random() > .5 ? 'concrete' : 'crate', 75);
  }

  // A broken perimeter of cover keeps the combat space readable and gives the shells something to tear through.
  buildBarrier(-88, -72, 9, true, 1, 'concrete');
  buildBarrier(88, -72, 9, true, 1, 'concrete');
  buildBarrier(-88, 72, 9, true, 1, 'concrete');
  buildBarrier(88, 72, 9, true, 1, 'concrete');

  aimMarker = new THREE.Group();
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(.62, .73, 32),
    new THREE.MeshBasicMaterial({ color: 0xd7f55d, transparent: true, opacity: .62, side: THREE.DoubleSide }),
  );
  markerRing.rotation.x = -Math.PI / 2;
  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(.09, 12),
    new THREE.MeshBasicMaterial({ color: 0xf5f8c5, transparent: true, opacity: .95, side: THREE.DoubleSide }),
  );
  markerDot.rotation.x = -Math.PI / 2;
  aimMarker.add(markerRing, markerDot);
  aimMarker.position.set(0, .08, -40);
  scene.add(aimMarker);
}

function createTankModel(color, accent, scale = 1) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: .75, metalness: .3 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2820, roughness: .9, metalness: .2 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: .65, metalness: .35 });
  addBox(root, [4.6, 1.1, 6.1], [0, 1.05, 0], bodyMaterial);
  addBox(root, [4.15, .55, 4.9], [0, 1.75, .25], bodyMaterial);
  addBox(root, [.72, 1.25, 5.9], [-2.38, .82, 0], darkMaterial);
  addBox(root, [.72, 1.25, 5.9], [2.38, .82, 0], darkMaterial);
  [-2.05, -.7, .7, 2.05].forEach((z) => {
    [-2.52, 2.52].forEach((x) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, .5, 14), darkMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, .75, z);
      wheel.castShadow = true;
      root.add(wheel);
    });
  });
  const turret = new THREE.Group();
  turret.position.y = 1.88;
  root.add(turret);
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.92, .55, 16), bodyMaterial);
  turretBase.position.y = 0;
  turretBase.castShadow = true;
  turret.add(turretBase);
  addBox(turret, [2.35, .72, 2.45], [0, .45, .12], bodyMaterial);
  addBox(turret, [.82, .25, 1.35], [0, .87, -.4], accentMaterial);
  const barrel = addBox(turret, [.44, .44, 5.55], [0, .42, -2.85], accentMaterial);
  barrel.castShadow = true;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, .42, -5.65);
  turret.add(muzzle);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 6), accentMaterial);
  antenna.position.set(1.1, 1.2, .45);
  turret.add(antenna);
  return { root, turret, muzzle };
}

function createJeepModel(color, accent, scale = 1) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .22 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2520, roughness: .86, metalness: .18 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: .62, metalness: .34 });
  addBox(root, [3.4, .66, 5.05], [0, .85, 0], bodyMaterial);
  addBox(root, [2.75, .52, 1.7], [0, 1.35, 1.35], bodyMaterial);
  addBox(root, [2.65, 1.45, .18], [0, 1.9, .15], darkMaterial);
  addBox(root, [.12, 1.35, .12], [-1.22, 1.84, .15], accentMaterial);
  addBox(root, [.12, 1.35, .12], [1.22, 1.84, .15], accentMaterial);
  [-1.38, 1.38].forEach((x) => [-1.62, 1.62].forEach((z) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.58, .58, .42, 12), darkMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, .58, z);
    wheel.castShadow = true;
    root.add(wheel);
  }));
  const turret = new THREE.Group();
  turret.position.y = 1.6;
  root.add(turret);
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(.65, .74, .38, 12), accentMaterial);
  turret.add(mount);
  addBox(turret, [.23, .23, 2.9], [0, .13, -1.35], accentMaterial);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, .13, -2.85);
  turret.add(muzzle);
  return { root, turret, muzzle };
}

function createArtilleryModel(color, accent, scale = 1) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: .3 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x202820, roughness: .9, metalness: .2 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: .64, metalness: .4 });
  addBox(root, [3.65, .9, 5.2], [0, .83, .25], bodyMaterial);
  addBox(root, [2.75, 1.35, 1.8], [0, 1.64, 1.48], bodyMaterial);
  addBox(root, [2.6, .3, 1.2], [0, 2.3, 1.3], accentMaterial);
  [-1.52, 1.52].forEach((x) => [-1.35, 1.72].forEach((z) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, .45, 12), darkMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, .65, z);
    wheel.castShadow = true;
    root.add(wheel);
  }));
  const turret = new THREE.Group();
  turret.position.y = 2.05;
  root.add(turret);
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(.8, 1.0, .42, 12), bodyMaterial);
  turret.add(mount);
  const barrel = addBox(turret, [.35, .35, 5.3], [0, .45, -2.55], accentMaterial);
  barrel.rotation.x = -0.08;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, .45, -5.3);
  turret.add(muzzle);
  return { root, turret, muzzle };
}

function makeUnitModel(kind, isPlayer) {
  const stats = UNIT_STATS[kind];
  if (kind === 'jeep') return createJeepModel(isPlayer ? 0x6c8757 : stats.color, isPlayer ? 0xb9da98 : stats.accent, isPlayer ? .95 : .9);
  if (kind === 'artillery') return createArtilleryModel(isPlayer ? 0x6c8757 : stats.color, isPlayer ? 0xb9da98 : stats.accent, isPlayer ? 1 : .94);
  return createTankModel(isPlayer ? 0x6c8757 : stats.color, isPlayer ? 0xb9da98 : stats.accent, isPlayer ? 1 : .96);
}

function createHealthBar() {
  const healthCanvas = document.createElement('canvas');
  healthCanvas.width = 128;
  healthCanvas.height = 14;
  const context = healthCanvas.getContext('2d');
  const texture = new THREE.CanvasTexture(healthCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(3.2, .35, 1);
  sprite.renderOrder = 8;
  return { canvas: healthCanvas, context, texture, sprite };
}

function updateHealthBar(unit) {
  if (!unit.healthBar) return;
  const { canvas, context, texture } = unit.healthBar;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(5,10,7,.82)';
  context.fillRect(0, 2, 128, 10);
  context.fillStyle = unit.type === 'artillery' ? '#e6cf91' : '#ff6f52';
  context.fillRect(2, 4, 124 * clamp(unit.health / unit.maxHealth, 0, 1), 6);
  context.strokeStyle = 'rgba(232,239,231,.55)';
  context.strokeRect(.5, 2.5, 127, 9);
  texture.needsUpdate = true;
}

function createUnit(kind, isPlayer, position) {
  const stats = UNIT_STATS[kind];
  const modelInfo = makeUnitModel(kind, isPlayer);
  const unit = {
    type: kind,
    isPlayer,
    model: modelInfo.root,
    turret: modelInfo.turret,
    muzzle: modelInfo.muzzle,
    position: modelInfo.root.position,
    yaw: 0,
    health: isPlayer ? 1600 : stats.maxHealth,
    maxHealth: isPlayer ? 1600 : stats.maxHealth,
    radius: isPlayer ? 3.0 : stats.radius,
    speed: isPlayer ? 0 : stats.speed,
    reload: 0,
    alive: true,
    lastHitAt: -10,
    orbitDirection: Math.random() > .5 ? 1 : -1,
    healthBar: null,
  };
  modelInfo.root.position.set(position[0], 0, position[1]);
  modelInfo.root.rotation.y = unit.yaw;
  scene.add(modelInfo.root);
  if (!isPlayer) {
    unit.healthBar = createHealthBar();
    unit.healthBar.sprite.position.y = kind === 'artillery' ? 5.1 : kind === 'jeep' ? 3.4 : 4.35;
    unit.model.add(unit.healthBar.sprite);
    updateHealthBar(unit);
  }
  return unit;
}

function spawnUnits() {
  player = createUnit('tank', true, [0, 28]);
  player.yaw = 0;
  const spawnList = [
    ['tank', -68, -47],
    ['tank', 57, -52],
    ['tank', 73, 15],
    ['tank', -78, 18],
    ['jeep', -70, 51],
    ['jeep', 4, 72],
    ['jeep', 72, 59],
    ['artillery', -75, 69],
    ['artillery', 75, -3],
  ];
  spawnList.forEach(([kind, x, z]) => {
    const unit = createUnit(kind, false, [x, z]);
    unit.yaw = Math.atan2(-x, -z);
    unit.model.rotation.y = unit.yaw;
    unit.reload = randomBetween(.45, 2.7);
    enemies.push(unit);
  });
}

function addLighting() {
  const hemisphere = new THREE.HemisphereLight(0x9fb99a, 0x18231a, 1.35);
  scene.add(hemisphere);
  sunLight = new THREE.DirectionalLight(0xffe4b3, 2.5);
  sunLight.position.set(-50, 78, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -110;
  sunLight.shadow.camera.right = 110;
  sunLight.shadow.camera.top = 110;
  sunLight.shadow.camera.bottom = -110;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 230;
  sunLight.shadow.bias = -.00015;
  scene.add(sunLight);
  scene.add(sunLight.target);
  sunLight.target.position.set(0, 0, 0);
  const rim = new THREE.DirectionalLight(0x96ceb2, .5);
  rim.position.set(80, 30, -70);
  scene.add(rim);
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, .1, 350);
  camera.position.set(0, 10, 42);
  clock = new THREE.Clock();

  addLighting();
  buildWorld();
  spawnUnits();
  bindInput();
  window.addEventListener('resize', onResize);
  addEvent('ARMOR LINK ESTABLISHED // COVER IS BREAKABLE');
  addEvent('MAIN CANNON READY // AP-HE LOAD', 'good');
  worldInitialized = true;
  requestAnimationFrame(animate);
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function bindInput() {
  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'Space' && state.started && !state.gameOver) firePlayer();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  canvas.addEventListener('pointermove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    crosshair.style.left = `${event.clientX}px`;
    crosshair.style.top = `${event.clientY}px`;
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    mouseDown = true;
    if (state.started && !state.gameOver) {
      canvas.setPointerCapture?.(event.pointerId);
      firePlayer();
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 0) {
      mouseDown = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }
  });
  canvas.addEventListener('pointerleave', () => { mouseDown = false; });
  startButton.addEventListener('click', () => {
    state.started = true;
    startScreen.classList.add('hidden');
    initAudio();
    playTone(100, .12, 'sine', .04);
    addEvent('MISSION LIVE // MOVE OUT', 'good');
    clock.getDelta();
  });
  restartButton.addEventListener('click', () => window.location.reload());
}

function initAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playTone(frequency, duration, type = 'sine', volume = .035) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function addEvent(message, tone = '') {
  const node = document.createElement('div');
  node.className = `event ${tone === 'danger' ? 'danger' : ''}`;
  node.textContent = message;
  ui.eventFeed.appendChild(node);
  while (ui.eventFeed.children.length > 4) ui.eventFeed.removeChild(ui.eventFeed.firstChild);
  window.setTimeout(() => node.classList.add('fade'), 2600);
  window.setTimeout(() => node.remove(), 4600);
}

function updateAim() {
  if (!player) return;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, tempVector);
  if (hit) {
    aimTarget.copy(hit);
    aimTarget.x = clamp(aimTarget.x, -ARENA_LIMIT, ARENA_LIMIT);
    aimTarget.z = clamp(aimTarget.z, -ARENA_LIMIT, ARENA_LIMIT);
  } else {
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    aimTarget.copy(player.model.position).addScaledVector(forward, 60);
    aimTarget.y = 0;
  }
  aimMarker.position.set(aimTarget.x, .08, aimTarget.z);
}

function getMuzzleTransform(unit) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  unit.muzzle.getWorldPosition(position);
  unit.muzzle.getWorldQuaternion(quaternion);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  return { position, direction };
}

function updatePlayer(delta) {
  if (!player || !player.alive) return;
  const forwardInput = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const turnInput = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  player.yaw += turnInput * (forwardInput < 0 ? -1 : 1) * 1.55 * delta;
  player.model.rotation.y = player.yaw;

  const speed = forwardInput >= 0 ? forwardInput * 12.5 : forwardInput * 7.4;
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const nextPosition = player.model.position.clone().addScaledVector(forward, speed * delta);
  nextPosition.x = clamp(nextPosition.x, -ARENA_LIMIT, ARENA_LIMIT);
  nextPosition.z = clamp(nextPosition.z, -ARENA_LIMIT, ARENA_LIMIT);
  if (!isBlockedAt(nextPosition, player.radius)) {
    player.model.position.copy(nextPosition);
  }
  state.currentSpeed = damp(state.currentSpeed, Math.abs(speed) * 3.2, 7, delta);

  const desiredTurretYaw = Math.atan2(aimTarget.x - player.model.position.x, -(aimTarget.z - player.model.position.z));
  const turretLocalYaw = desiredTurretYaw - player.yaw;
  player.turret.rotation.y = lerpAngle(player.turret.rotation.y, turretLocalYaw, 1 - Math.exp(-8 * delta));
  player.reload = Math.max(0, player.reload - delta);
  if (player.reload <= 0 && state.started && (mouseDown || keys.has('Space'))) firePlayer(false);

  if (state.elapsed - player.lastHitAt > 2 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + 7 * delta);
  }
}

function isBlockedAt(position, radius) {
  for (const block of destructibles) {
    if (!block.active) continue;
    const dx = Math.max(Math.abs(position.x - block.mesh.position.x) - block.size.x / 2, 0);
    const dz = Math.max(Math.abs(position.z - block.mesh.position.z) - block.size.z / 2, 0);
    if (dx * dx + dz * dz < radius * radius && block.mesh.position.y - block.size.y / 2 < 2.7) return true;
  }
  return false;
}

function firePlayer(shouldNotify = true) {
  if (!state.started || state.gameOver || !player || !player.alive || player.reload > 0) return;
  const transform = getMuzzleTransform(player);
  const stats = { damage: 190, blastRadius: 5.1, shellSpeed: 68 };
  transform.position.addScaledVector(transform.direction, .7);
  spawnProjectile(transform.position, transform.direction, 'player', stats.damage, stats.blastRadius, stats.shellSpeed);
  createMuzzleFlash(transform.position, transform.direction, 0xd7f55d);
  player.reload = .86;
  state.screenShake = Math.max(state.screenShake, .22);
  playTone(74, .12, 'sawtooth', .07);
  if (shouldNotify) addEvent('MAIN CANNON // AP-HE AWAY', 'good');
}

function spawnProjectile(position, direction, owner, damage, blastRadius, speed) {
  const color = owner === 'player' ? 0xd7f55d : 0xff805d;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .96 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(owner === 'player' ? .2 : .16, 8, 8), material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  scene.add(mesh);
  projectiles.push({
    mesh,
    velocity: direction.clone().normalize().multiplyScalar(speed),
    owner,
    damage,
    blastRadius,
    age: 0,
    maxAge: 4.2,
  });
}

function distanceToSegmentSquared(point, start, end) {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return { distance: point.distanceToSquared(start), t: 0 };
  const t = clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
  const closest = start.clone().addScaledVector(segment, t);
  return { distance: point.distanceToSquared(closest), t };
}

function findProjectileHit(projectile, from, to) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length === 0) return null;
  direction.normalize();
  const ray = new THREE.Ray(from, direction);
  let nearest = null;
  let nearestDistance = length + 1;
  const hitPoint = new THREE.Vector3();
  for (const block of destructibles) {
    if (!block.active) continue;
    const point = ray.intersectBox(block.box, hitPoint);
    if (point) {
      const distance = point.distanceTo(from);
      if (distance <= length && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { kind: 'block', block, point: point.clone() };
      }
    }
  }
  const possibleUnits = projectile.owner === 'player' ? enemies : [player];
  for (const unit of possibleUnits) {
    if (!unit || !unit.alive) continue;
    const center = unit.model.position.clone();
    center.y += unit.type === 'jeep' ? 1.15 : 1.45;
    const result = distanceToSegmentSquared(center, from, to);
    const collisionRadius = unit.radius * .78;
    if (result.distance <= collisionRadius * collisionRadius) {
      const distance = length * result.t;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { kind: 'unit', unit, point: from.clone().lerp(to, result.t) };
      }
    }
  }
  return nearest;
}

function updateProjectiles(delta) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    projectile.age += delta;
    const from = projectile.mesh.position.clone();
    projectile.velocity.y -= projectile.owner === 'player' ? 2.6 * delta : 3.8 * delta;
    const to = from.clone().addScaledVector(projectile.velocity, delta);
    const hit = findProjectileHit(projectile, from, to);
    if (hit || to.y < .12 || projectile.age > projectile.maxAge || Math.abs(to.x) > 120 || Math.abs(to.z) > 120) {
      const impact = hit ? hit.point : to;
      if (hit || to.y < .12) detonate(projectile, impact);
      scene.remove(projectile.mesh);
      projectile.mesh.geometry.dispose();
      projectile.mesh.material.dispose();
      projectiles.splice(i, 1);
    } else {
      projectile.mesh.position.copy(to);
      if (Math.random() < .55) createTracer(projectile.mesh.position, projectile.owner === 'player' ? 0xd7f55d : 0xff805d);
    }
  }
}

function createTracer(position, color) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.055, 5, 5), material);
  mesh.position.copy(position);
  scene.add(mesh);
  effects.push({ type: 'tracer', mesh, age: 0, maxAge: .16 });
}

function detonate(projectile, position) {
  const visualColor = projectile.owner === 'player' ? 0xd7f55d : 0xff805d;
  createExplosion(position, projectile.blastRadius, visualColor);
  const blockDamage = projectile.owner === 'player' ? projectile.damage * .95 : projectile.damage * .82;
  for (const block of destructibles) {
    if (!block.active) continue;
    const distance = block.mesh.position.distanceTo(position);
    const reach = projectile.blastRadius + Math.max(block.size.x, block.size.y, block.size.z) * .38;
    if (distance < reach) {
      const falloff = 1 - clamp(distance / reach, 0, .9);
      damageBlock(block, blockDamage * falloff, position);
    }
  }
  const targets = projectile.owner === 'player' ? enemies : [player];
  for (const unit of targets) {
    if (!unit || !unit.alive) continue;
    const distance = unit.model.position.distanceTo(position);
    const reach = projectile.blastRadius + unit.radius;
    if (distance < reach) {
      const falloff = 1 - clamp(distance / reach, 0, .85);
      damageUnit(unit, projectile.damage * (.45 + falloff * .55));
    }
  }
  if (projectile.owner === 'player') playTone(48, .16, 'square', .035);
  else playTone(42, .13, 'sawtooth', .025);
  state.screenShake = Math.max(state.screenShake, projectile.owner === 'player' ? .35 : .16);
}

function damageBlock(block, amount, impactPosition) {
  if (!block.active) return;
  block.health -= amount;
  if (!block.damaged) {
    block.damaged = true;
    block.mesh.material.color.multiplyScalar(.78);
  }
  if (block.health <= 0) {
    block.active = false;
    scene.remove(block.mesh);
    spawnBlockDebris(block.mesh.position, block.size, block.type);
    block.mesh.geometry.dispose();
    block.mesh.material.dispose();
    if (Math.random() < .27) addEvent('STRUCTURAL COLLAPSE // COVER REMOVED');
  } else if (Math.random() < .17) {
    createDustBurst(impactPosition, 0xadb99f);
  }
}

function spawnBlockDebris(position, size, type) {
  const baseColor = type === 'crate' ? 0xb58d52 : type === 'brick' ? 0xb4775b : 0xb8c4b2;
  const count = type === 'crate' ? 4 : 5;
  for (let i = 0; i < count; i += 1) {
    const material = new THREE.MeshStandardMaterial({ color: baseColor, roughness: .9, transparent: true });
    const piece = new THREE.Mesh(new THREE.BoxGeometry(randomBetween(.16, .45), randomBetween(.16, .45), randomBetween(.16, .45)), material);
    piece.position.copy(position).add(new THREE.Vector3(randomBetween(-size.x * .42, size.x * .42), randomBetween(-size.y * .2, size.y * .2), randomBetween(-size.z * .42, size.z * .42)));
    piece.castShadow = true;
    scene.add(piece);
    effects.push({
      type: 'debris', mesh: piece, age: 0, maxAge: randomBetween(.55, 1.25),
      velocity: new THREE.Vector3(randomBetween(-4, 4), randomBetween(3, 9), randomBetween(-4, 4)),
      spin: new THREE.Vector3(randomBetween(-8, 8), randomBetween(-8, 8), randomBetween(-8, 8)),
    });
  }
}

function damageUnit(unit, amount) {
  if (!unit || !unit.alive) return;
  if (unit.isPlayer) {
    amount *= .52; // The player has deliberately reinforced armor; enemy fire is pressure, not an instant fail state.
    player.lastHitAt = state.elapsed;
    player.health = Math.max(0, player.health - amount);
    damageFlash.classList.add('active');
    window.clearTimeout(damageUnit.flashTimeout);
    damageUnit.flashTimeout = window.setTimeout(() => damageFlash.classList.remove('active'), 130);
    if (player.health <= 0) {
      player.alive = false;
      createExplosion(player.model.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 7, 0xff805d);
      scene.remove(player.model);
      addEvent('IRONCLAD-01 // HULL FAILURE', 'danger');
      window.setTimeout(() => showResult(false), 1250);
    } else if (Math.random() < .3) {
      addEvent(`ARMOR HIT // ${Math.ceil(amount)} DAMAGE ABSORBED`, 'danger');
    }
  } else {
    unit.health = Math.max(0, unit.health - amount);
    updateHealthBar(unit);
    if (unit.health <= 0) destroyEnemy(unit);
  }
}

function destroyEnemy(unit) {
  if (!unit.alive) return;
  unit.alive = false;
  state.destroyedHostiles += 1;
  state.score += UNIT_STATS[unit.type].score;
  const position = unit.model.position.clone().add(new THREE.Vector3(0, 1, 0));
  createExplosion(position, unit.type === 'artillery' ? 5.2 : 4.1, unit.type === 'artillery' ? 0xe7c885 : 0xff805d);
  scene.remove(unit.model);
  addEvent(`${UNIT_STATS[unit.type].label} DESTROYED // +${UNIT_STATS[unit.type].score}`, 'good');
  playTone(60, .24, 'sawtooth', .06);
  if (enemies.every((enemy) => !enemy.alive) && !state.resultQueued) {
    state.resultQueued = true;
    addEvent('SECTOR CLEAR // YARD SECURED', 'good');
    window.setTimeout(() => showResult(true), 1450);
  }
}

function hasLineOfSight(start, end) {
  const direction = end.clone().sub(start);
  const distance = direction.length();
  direction.normalize();
  const ray = new THREE.Ray(start, direction);
  const point = new THREE.Vector3();
  for (const block of destructibles) {
    if (!block.active) continue;
    if (ray.intersectBox(block.box, point) && point.distanceTo(start) < distance - 2) return false;
  }
  return true;
}

function updateEnemies(delta) {
  if (!player || !player.alive) return;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const stats = UNIT_STATS[enemy.type];
    enemy.reload = Math.max(0, enemy.reload - delta);
    const toPlayer = player.model.position.clone().sub(enemy.model.position);
    const distance = toPlayer.length();
    const desiredYaw = Math.atan2(toPlayer.x, -toPlayer.z);
    enemy.yaw = lerpAngle(enemy.yaw, desiredYaw, 1 - Math.exp(-2.5 * delta));
    enemy.model.rotation.y = enemy.yaw;

    let drive = 0;
    if (distance > stats.range * .73) drive = 1;
    else if (distance < stats.range * .38 && enemy.type !== 'artillery') drive = -.42;
    else if (enemy.type === 'jeep') drive = .24;
    const forward = new THREE.Vector3(-Math.sin(enemy.yaw), 0, -Math.cos(enemy.yaw));
    const next = enemy.model.position.clone().addScaledVector(forward, drive * stats.speed * delta);
    next.x = clamp(next.x, -ARENA_LIMIT, ARENA_LIMIT);
    next.z = clamp(next.z, -ARENA_LIMIT, ARENA_LIMIT);
    if (drive !== 0 && !isBlockedAt(next, enemy.radius)) enemy.model.position.copy(next);

    // Small separation prevents the red units from stacking into one silhouette.
    for (const other of enemies) {
      if (other === enemy || !other.alive) continue;
      const separation = enemy.model.position.clone().sub(other.model.position);
      separation.y = 0;
      const minimum = enemy.radius + other.radius;
      if (separation.lengthSq() < minimum * minimum && separation.lengthSq() > .001) {
        separation.normalize().multiplyScalar((minimum - separation.length()) * .012);
        enemy.model.position.add(separation);
      }
    }

    const target = player.model.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const turretWorldYaw = Math.atan2(target.x - enemy.model.position.x, -(target.z - enemy.model.position.z));
    enemy.turret.rotation.y = lerpAngle(enemy.turret.rotation.y, turretWorldYaw - enemy.yaw, 1 - Math.exp(-5 * delta));
    if (enemy.reload <= 0 && distance < stats.range && hasLineOfSight(enemy.muzzle.getWorldPosition(tempVector), target)) {
      fireEnemy(enemy);
    }
    if (enemy.healthBar) enemy.healthBar.sprite.quaternion.copy(camera.quaternion);
  }
}

function fireEnemy(enemy) {
  const stats = UNIT_STATS[enemy.type];
  const transform = getMuzzleTransform(enemy);
  const target = player.model.position.clone().add(new THREE.Vector3(0, 1.15, 0));
  const direction = target.sub(transform.position).normalize();
  transform.position.addScaledVector(direction, .55);
  spawnProjectile(transform.position, direction, 'enemy', stats.damage, stats.blastRadius, stats.shellSpeed);
  createMuzzleFlash(transform.position, direction, enemy.type === 'artillery' ? 0xe7c885 : 0xff805d);
  enemy.reload = stats.fireRate;
}

function createMuzzleFlash(position, direction, color) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(.5, 8, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.copy(position).addScaledVector(direction, .35);
  flash.scale.set(.65, .65, 1.55);
  scene.add(flash);
  effects.push({ type: 'muzzle', mesh: flash, age: 0, maxAge: .095 });
}

function createDustBurst(position, color = 0xb7c6ad) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .48, depthWrite: false });
  const dust = new THREE.Mesh(new THREE.SphereGeometry(.5, 8, 8), material);
  dust.position.copy(position);
  scene.add(dust);
  effects.push({ type: 'dust', mesh: dust, age: 0, maxAge: .42 });
}

function createExplosion(position, radius, color) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.copy(position);
  flash.scale.setScalar(.55);
  scene.add(flash);
  effects.push({ type: 'explosion', mesh: flash, age: 0, maxAge: .34, radius });

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.55, .72, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .78, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  ring.position.y = .12;
  scene.add(ring);
  effects.push({ type: 'ring', mesh: ring, age: 0, maxAge: .5, radius });

  const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: createSmokeTexture(), transparent: true, opacity: .4, depthWrite: false }));
  smoke.position.copy(position).add(new THREE.Vector3(0, .7, 0));
  smoke.scale.set(2.1, 2.1, 1);
  scene.add(smoke);
  effects.push({ type: 'smoke', mesh: smoke, age: 0, maxAge: 1.05, radius });

  for (let i = 0; i < 13; i += 1) {
    const particleMaterial = new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffd26e : color, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false });
    const particle = new THREE.Mesh(new THREE.BoxGeometry(randomBetween(.06, .18), randomBetween(.06, .18), randomBetween(.06, .18)), particleMaterial);
    particle.position.copy(position);
    scene.add(particle);
    effects.push({
      type: 'particle', mesh: particle, age: 0, maxAge: randomBetween(.35, .75),
      velocity: new THREE.Vector3(randomBetween(-radius * 1.4, radius * 1.4), randomBetween(1.6, radius * 1.8), randomBetween(-radius * 1.4, radius * 1.4)),
    });
  }
  const light = new THREE.PointLight(color, 7, radius * 5, 2);
  light.position.copy(position);
  scene.add(light);
  effects.push({ type: 'light', mesh: light, age: 0, maxAge: .3 });
}

function updateEffects(delta) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    effect.age += delta;
    const progress = effect.age / effect.maxAge;
    if (effect.age >= effect.maxAge) {
      scene.remove(effect.mesh);
      if (effect.mesh.geometry) effect.mesh.geometry.dispose();
      if (effect.mesh.material) {
        if (Array.isArray(effect.mesh.material)) effect.mesh.material.forEach((material) => material.dispose());
        else effect.mesh.material.dispose();
      }
      effects.splice(i, 1);
      continue;
    }
    if (effect.type === 'explosion') {
      const scale = .55 + progress * effect.radius * 1.4;
      effect.mesh.scale.setScalar(scale);
      effect.mesh.material.opacity = .78 * (1 - progress);
    } else if (effect.type === 'ring') {
      const scale = 1 + progress * effect.radius * 2.7;
      effect.mesh.scale.set(scale, scale, scale);
      effect.mesh.material.opacity = .74 * (1 - progress);
    } else if (effect.type === 'smoke') {
      const scale = 1.3 + progress * effect.radius * .8;
      effect.mesh.scale.set(scale, scale, 1);
      effect.mesh.position.y += delta * .5;
      effect.mesh.material.opacity = .38 * (1 - progress);
    } else if (effect.type === 'particle' || effect.type === 'debris') {
      effect.velocity.y -= 11 * delta;
      effect.mesh.position.addScaledVector(effect.velocity, delta);
      if (effect.mesh.position.y < .08) {
        effect.mesh.position.y = .08;
        effect.velocity.y *= -.32;
      }
      if (effect.spin) {
        effect.mesh.rotation.x += effect.spin.x * delta;
        effect.mesh.rotation.y += effect.spin.y * delta;
        effect.mesh.rotation.z += effect.spin.z * delta;
      }
      effect.mesh.material.opacity = 1 - progress;
    } else if (effect.type === 'dust') {
      const scale = 1 + progress * 3;
      effect.mesh.scale.setScalar(scale);
      effect.mesh.material.opacity = .5 * (1 - progress);
    } else if (effect.type === 'muzzle') {
      effect.mesh.scale.multiplyScalar(.83);
      effect.mesh.material.opacity = 1 - progress;
    } else if (effect.type === 'tracer') {
      effect.mesh.material.opacity = .35 * (1 - progress);
    } else if (effect.type === 'light') {
      effect.mesh.intensity = 7 * (1 - progress);
    }
  }
}

function updateCamera(delta) {
  if (!player) return;
  const followOffset = new THREE.Vector3(0, 8.2, 14.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
  const desiredPosition = player.model.position.clone().add(followOffset);
  camera.position.lerp(desiredPosition, 1 - Math.exp(-4.2 * delta));
  if (state.screenShake > .001) {
    camera.position.x += randomBetween(-state.screenShake, state.screenShake) * .18;
    camera.position.y += randomBetween(-state.screenShake, state.screenShake) * .12;
    state.screenShake = Math.max(0, state.screenShake - delta * 1.8);
  }
  const lookAt = player.model.position.clone().add(new THREE.Vector3(0, 1.45, 0));
  camera.lookAt(lookAt);
}

function updateHUD(delta) {
  if (!player) return;
  const armorPercent = clamp(player.health / player.maxHealth, 0, 1);
  ui.armorValue.textContent = `${Math.round(armorPercent * 100)}%`;
  ui.armorFill.style.width = `${armorPercent * 100}%`;
  ui.armorState.textContent = armorPercent > .7 ? 'NOMINAL' : armorPercent > .35 ? 'COMPROMISED' : 'CRITICAL';
  ui.armorState.style.color = armorPercent > .7 ? '' : armorPercent > .35 ? 'var(--orange)' : 'var(--red)';
  const reloadPercent = clamp(1 - player.reload / .86, 0, 1);
  ui.weaponFill.style.width = `${reloadPercent * 100}%`;
  ui.weaponStatus.textContent = player.reload <= 0 ? 'READY' : 'RELOADING';
  ui.weaponStatus.style.color = player.reload <= 0 ? '' : 'var(--orange)';
  crosshair.classList.toggle('is-reloading', player.reload > 0);
  ui.speed.textContent = Math.round(state.currentSpeed).toString().padStart(3, '0');
  ui.objectiveCount.textContent = `${state.destroyedHostiles} / ${state.totalHostiles}`;
  ui.objectiveProgress.style.width = `${(state.destroyedHostiles / state.totalHostiles) * 100}%`;
  ui.objectiveTitle.textContent = state.destroyedHostiles === state.totalHostiles ? 'YARD SECURED' : 'CLEAR THE IRON YARD';
  ui.objectiveDetail.textContent = state.destroyedHostiles === state.totalHostiles ? 'All hostile signatures have gone dark.' : 'Neutralize hostile armor before they breach the perimeter.';
  const counts = { tank: 0, jeep: 0, artillery: 0 };
  enemies.forEach((enemy) => { if (enemy.alive) counts[enemy.type] += 1; });
  ui.tankCount.textContent = counts.tank.toString().padStart(2, '0');
  ui.jeepCount.textContent = counts.jeep.toString().padStart(2, '0');
  ui.artilleryCount.textContent = counts.artillery.toString().padStart(2, '0');
  const totalSeconds = Math.floor(state.elapsed);
  const clockText = `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
  if (clockText !== state.lastClockText) {
    ui.clock.textContent = clockText;
    state.lastClockText = clockText;
  }
  updateRadar();
  void delta;
}

function updateRadar() {
  const context = radarContext;
  const size = radar.width;
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.fillStyle = 'rgba(7,17,11,.38)';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(161,207,157,.22)';
  context.lineWidth = 1;
  [28, 56, 84].forEach((radius) => {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.stroke();
  });
  context.beginPath(); context.moveTo(center, 6); context.lineTo(center, size - 6); context.moveTo(6, center); context.lineTo(size - 6, center); context.stroke();
  if (!player) return;
  const range = 96;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.model.position.x - player.model.position.x;
    const dz = enemy.model.position.z - player.model.position.z;
    const x = center + clamp(dx / range, -1, 1) * 79;
    const y = center + clamp(dz / range, -1, 1) * 79;
    if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
    context.fillStyle = enemy.type === 'artillery' ? '#e7cf91' : '#ff6f52';
    context.save();
    context.translate(x, y);
    context.rotate(Math.atan2(dx, -dz));
    context.beginPath();
    context.moveTo(0, -5); context.lineTo(4, 4); context.lineTo(-4, 4); context.closePath(); context.fill();
    context.restore();
  }
  context.fillStyle = '#9ce5da';
  context.beginPath();
  context.arc(center, center, 4, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(156,229,218,.75)';
  context.beginPath(); context.moveTo(center, center - 8); context.lineTo(center, center - 14); context.stroke();
}

function showResult(victory) {
  if (state.gameOver) return;
  state.gameOver = true;
  gameOver.classList.remove('hidden');
  ui.finalScore.textContent = formatScore(state.score + (victory ? Math.max(0, Math.round(player.health)) : 0));
  if (victory) {
    ui.gameOverTitle.innerHTML = 'YARD <em>SECURED</em>';
    ui.gameOverDetail.innerHTML = 'The hostile line has been broken.<br /><strong>Ironclad-01 remains operational.</strong>';
  } else {
    ui.gameOverTitle.innerHTML = 'IRONCLAD <em>DOWN</em>';
    ui.gameOverDetail.innerHTML = 'The hull finally gave way.<br /><strong>Reinforced armor bought the yard time.</strong>';
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), .05);
  if (state.started && !state.gameOver) {
    state.elapsed += delta;
    updateAim();
    updatePlayer(delta);
    updateEnemies(delta);
    updateProjectiles(delta);
    updateEffects(delta);
  } else {
    updateAim();
    updateEffects(delta);
  }
  updateCamera(delta);
  updateHUD(delta);
  renderer.render(scene, camera);
}

init();
