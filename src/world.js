import * as THREE from 'three';
import {
  fbm, smoothstep, smootherstep, clamp, lerp, damp, mulberry32, randRange, shortestAngle,
} from './utils.js';
import {
  makeToonGradient, makeGlowTexture, makeDotTexture, makePetalTexture,
  makeGrassTexture, makeCloudTexture,
} from './textures.js';

export const WATER_LEVEL = 2;
export const WORLD_EDGE = 760;
export const START_POSITION = new THREE.Vector3(-370, 138, 168);

const GATE_DEFS = [
  { name: 'Whisper of the Grass', pos: [-62, 126, 70] },
  { name: 'The Lake’s Memory', pos: [-158, 82, 8] },
  { name: 'A Drift of Pollen', pos: [-250, 118, 30] },
  { name: 'The Sunken Bell', pos: [-300, 132, -118] },
  { name: 'Pine Song', pos: [-122, 166, -258] },
  { name: 'Cloud’s Cradle', pos: [62, 212, -332] },
  { name: 'Moonlit Feather', pos: [232, 146, -152] },
  { name: 'The Distant Kite', pos: [282, 112, 42] },
  { name: 'Homeward', pos: [170, 154, 330] },
];

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 46;
  h += 22 * fbm(x * 0.0032 + 12.7, z * 0.0032 + 5.1, 4);
  h += 34 * fbm(x * 0.0011 + 4.2, z * 0.0011 + 9.8, 3);

  // the high meadow that holds the Elder Tree
  const dt = Math.hypot(x - 40, z + 150);
  h += 42 * Math.exp(-(dt * dt) / (2 * 110 * 110));
  // a low, open bowl near the starting air
  const dv = Math.hypot(x - 20, z - 170);
  h -= 14 * Math.exp(-(dv * dv) / (2 * 180 * 180));

  // the lake — a deep blue basin to the west
  const dl = Math.hypot(x + 320, z - 70);
  h -= 124 * smootherstep(248, 34, dl);

  // encircling mountains
  const edge = smoothstep(430, 860, r);
  h += edge * (50 + 330 * fbm(x * 0.0022 + 30, z * 0.0022 + 6, 5));
  // a taller northern range
  const north = smoothstep(160, 640, -z) * smoothstep(250, 780, r);
  h += north * 115 * fbm(x * 0.0028 + 71, z * 0.0028 + 42, 4);

  return h;
}

function slopeAt(x, z) {
  const e = 3;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

const C = (hex) => new THREE.Color(hex);

export class World {
  constructor(scene, renderer, options = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.lowQuality = !!options.lowQuality;
    this.time = 0;
    this.rng = mulberry32(20241109);
    this.gates = [];
    this.collected = 0;
    this.blooming = false;
    this.bloomProgress = 0;
    this.petals = null;
    this.treeLight = null;
    this.windmillBlades = null;
    this.flock = null;
    this.islands = [];
    this.flowers = null;

    this.sunDir = new THREE.Vector3(-0.48, 0.42, -0.72).normalize();
    this.fogColor = C('#c9dade');
    this.glowTexture = makeGlowTexture(128);
    this.dotTexture = makeDotTexture(64);
    this.petalTexture = makePetalTexture(64);
    this.gradient = makeToonGradient([88, 154, 216, 255]);
    this.cloudGradient = makeToonGradient([146, 194, 232, 255]);

    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.00055);

    this._createSky();
    this._createLights();
    this._createTerrain();
    this._createWater();
    this._createTrees();
    this._createForestDetails();
    this._createFlowers();
    this._createVillage();
    this._createGreatTree();
    this._createFloatingIslands();
    this._createClouds();
    this._createGates();
    this._createPollen();
    this._createFlock();
  }

  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  _createSky() {
    const uniforms = {
      uSunDir: { value: this.sunDir },
      uZenith: { value: C('#2f6fae') },
      uHorizon: { value: C('#c6dee7') },
      uHaze: { value: C('#f5d7a7') },
      uSunColor: { value: C('#ffdda0') },
      uCloudColor: { value: C('#fff4e1') },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uHaze;
        uniform vec3 uSunColor;
        uniform vec3 uCloudColor;
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = p * 2.03 + 11.7;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float t = pow(clamp(h, 0.0, 1.0), 0.34);
          vec3 col = mix(uHorizon, uZenith, t);

          // warm haze hugging the horizon
          col = mix(col, uHaze, smoothstep(0.11, -0.06, h) * 0.82);

          // low, honeyed sun
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * pow(s, 1200.0) * 3.2;
          col += uSunColor * pow(s, 60.0) * 0.14;
          col += uSunColor * pow(s, 7.0) * 0.045;

          // drifting high cirrus
          vec2 uv = d.xz / (max(abs(h), 0.04) + 0.09);
          float n = fbm(uv * 1.35 + vec2(uTime * 0.0022, uTime * 0.0011));
          float streaks = fbm(uv * vec2(0.5, 3.2) + 17.0);
          float cirrus = smoothstep(0.52, 0.82, n * 0.62 + streaks * 0.55);
          cirrus *= smoothstep(0.03, 0.24, h) * (0.35 + 0.65 * smoothstep(0.75, 0.15, h));
          col = mix(col, uCloudColor, cirrus * 0.38);

          // tiny warm bloom at the horizon line
          col += uHaze * smoothstep(0.03, 0.0, abs(h - 0.015)) * 0.12;

          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          col += (dither - 0.5) / 420.0;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyUniforms = uniforms;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 48, 28), material);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // sun glow sprite
    const sunSpriteMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffe3b0,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.scale.setScalar(260);
    sunSprite.position.copy(this.sunDir).multiplyScalar(3000);
    sunSprite.renderOrder = -1;
    this.scene.add(sunSprite);
    this.sunSprite = sunSprite;
    this.sky.add(sunSprite);
  }

  _createLights() {
    const hemi = new THREE.HemisphereLight(0xaecdec, 0x596c40, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd39a, 3.05);
    sun.position.copy(this.sunDir).multiplyScalar(330);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.lowQuality ? 1024 : 2048, this.lowQuality ? 1024 : 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 850;
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.2;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;

    // cool bounce from the opposite sky, no shadows
    const fill = new THREE.DirectionalLight(0x9ec6e8, 0.4);
    fill.position.set(0.7, 0.35, 0.8).multiplyScalar(300);
    this.scene.add(fill);

    // a faint amber bounce off the meadow
    const bounce = new THREE.DirectionalLight(0xffe6b0, 0.18);
    bounce.position.set(0.1, -1, 0.2).multiplyScalar(300);
    this.scene.add(bounce);
  }

  _createTerrain() {
    const size = 1900;
    const seg = this.lowQuality ? 200 : 300;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);

    const sand = C('#dfce9f');
    const grassLight = C('#afc173');
    const grassMid = C('#82a85b');
    const grassDeep = C('#5f8a4f');
    const forest = C('#456f45');
    const rock = C('#918d7c');
    const rockWarm = C('#b7ac95');
    const snow = C('#f0eee2');
    const wild = C('#cfcf88');
    const dry = C('#c4b374');
    const blossom = C('#c9b7af');
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let h = terrainHeight(x, z);
      // soften the very outer lip so the world doesn't end in a wall
      pos.setY(i, h);

      const slope = slopeAt(x, z);
      const patch = fbm(x * 0.014 + 3.3, z * 0.014 + 9.1, 3);
      const fine = fbm(x * 0.055 + 4.2, z * 0.055 + 1.7, 2);
      const blossoms = fbm(x * 0.021 + 51.2, z * 0.021 + 27.4, 2);

      if (h < WATER_LEVEL + 2.4) {
        tmp.copy(sand);
      } else {
        tmp.copy(grassMid);
        tmp.lerp(grassLight, smoothstep(0.42, 0.78, patch) * 0.9);
        tmp.lerp(grassDeep, smoothstep(0.55, 0.2, patch) * 0.6);
        tmp.lerp(forest, smoothstep(90, 230, h) * 0.55);
        if (patch > 0.62 && h < 150) tmp.lerp(wild, (patch - 0.62) * 1.1);
        if (patch < 0.36 && h < 130) tmp.lerp(dry, (0.36 - patch) * 0.9);
        if (blossoms > 0.68 && h < 130) tmp.lerp(blossom, (blossoms - 0.68) * 0.65);
        tmp.offsetHSL(0, 0, (fine - 0.5) * 0.06);
      }

      // exposed rock on steep faces
      const rockMix = smoothstep(0.42, 0.9, slope);
      if (h > WATER_LEVEL + 3) {
        tmp.lerp(slope > 0.75 ? rockWarm : rock, rockMix * 0.85);
      }
      // high country
      if (h > 220) tmp.lerp(rock, smoothstep(220, 320, h) * 0.75);
      if (h > 315) tmp.lerp(snow, smoothstep(315, 400, h) * 0.9);

      // beach transition
      tmp.lerp(sand, smoothstep(WATER_LEVEL + 5.5, WATER_LEVEL + 0.3, h) * 0.9);

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const grassTex = makeGrassTexture();
    grassTex.repeat.set(68, 68);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: grassTex,
      roughness: 0.97,
      metalness: 0,
      dithering: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  _createWater() {
    const size = 2800;
    const seg = this.lowQuality ? 150 : 210;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const depths = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      depths[i] = clamp(WATER_LEVEL - terrainHeight(x, z), 0, 70);
      pos.setY(i, WATER_LEVEL);
    }
    geo.setAttribute('depth', new THREE.BufferAttribute(depths, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDir },
        uShallow: { value: C('#5fc5b7') },
        uDeep: { value: C('#0e5474') },
        uSkyTop: { value: C('#4f86bd') },
        uSkyHorizon: { value: C('#f4d5a3') },
        uSunColor: { value: C('#ffe6b5') },
        uFogColor: { value: this.fogColor },
        uFogDensity: { value: 0.00055 },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        attribute float depth;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        void main() {
          vec3 p = position;
          float t = uTime;
          float a = 0.34;
          float w1 = sin(p.x * 0.055 + t * 0.85) * 0.55;
          float w2 = sin(p.z * 0.041 - t * 0.62 + 1.3) * 0.44;
          float w3 = sin((p.x + p.z) * 0.105 + t * 1.55) * 0.16;
          p.y += (w1 + w2 + w3) * a;

          float dx = cos(p.x * 0.055 + t * 0.85) * 0.055 * 0.55 * a
                   + cos((p.x + p.z) * 0.105 + t * 1.55) * 0.105 * 0.16 * a;
          float dz = cos(p.z * 0.041 - t * 0.62 + 1.3) * 0.041 * 0.44 * a
                   + cos((p.x + p.z) * 0.105 + t * 1.55) * 0.105 * 0.16 * a;
          vNormalW = normalize(vec3(-dx, 1.0, -dz));
          vDepth = depth;

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNormalW;

        float hash(vec2 p) {
          p = fract(p * vec2(233.34, 851.73));
          p += dot(p, p + 23.45);
          return fract(p.x * p.y);
        }

        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNormalW);
          float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);

          float d = smoothstep(0.0, 1.0, vDepth / 34.0);
          vec3 col = mix(uShallow, uDeep, d);

          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(-0.05, 0.65, R.y));
          col = mix(col, sky, fres * 0.62);

          vec3 H = normalize(V + uSunDir);
          float spec = pow(max(dot(N, H), 0.0), 260.0);
          float sparkle = pow(max(dot(N, H), 0.0), 900.0);
          col += uSunColor * (spec * 1.15 + sparkle * 1.8);

          // little wind-ruffled sparkle flecks
          vec2 gp = floor(vWorld.xz * 1.3);
          float s = hash(gp);
          if (s > 0.982) {
            float tw = sin(uTime * 2.3 + s * 30.0) * 0.5 + 0.5;
            col += uSunColor * tw * 0.35 * smoothstep(0.0, 0.4, spec + 0.08);
          }

          // lace of foam where the lake breathes against the shore
          float foamBand = smoothstep(4.2, 0.35, vDepth);
          float ripple = sin(vWorld.x * 0.32 + vWorld.z * 0.27 + uTime * 1.7) * 0.5 + 0.5;
          float foam = foamBand * smoothstep(0.56, 0.94, ripple) * 0.42;
          col = mix(col, vec3(0.94, 0.97, 0.94), foam);

          float dist = length(cameraPosition - vWorld);
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.water = mesh;
    this.waterUniforms = mat.uniforms;
  }

  _createTrees() {
    const rng = this.rng;
    const count = this.lowQuality ? 360 : 620;
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.95, 1, 6, 1);
    trunkGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const canopyMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: this.gradient,
      roughness: 1,
      emissive: C('#20351f'),
      emissiveIntensity: 0.08,
    });

    const trees = [];
    let tries = 0;
    while (trees.length < count && tries < count * 14) {
      tries++;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 560;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 7) continue;
      if (slopeAt(x, z) > 0.55) continue;
      if (Math.hypot(x - 40, z + 150) < 48) continue; // keep the Elder Tree's glade open
      if (Math.hypot(x - 150, z - 90) < 60) continue; // village
      if (Math.hypot(x - 20, z - 220) < 60) continue; // start clearing
      trees.push({ x, z, h, scale: randRange(rng, 0.7, 1.55) });
    }

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length * 3);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const colors = [
      C('#456f45'), C('#527f4b'), C('#649253'), C('#7ba15e'), C('#396443'), C('#8fae65'),
      C('#3d6a4a'), C('#6f9a52'),
    ];
    const blossomColors = [C('#dba6b1'), C('#e6b6bd'), C('#ca94a8')];
    const c = new THREE.Color();
    let ci = 0;

    trees.forEach((t, i) => {
      const trunkH = randRange(rng, 8, 17) * t.scale;
      const trunkW = randRange(rng, 0.55, 1.05) * t.scale;
      const flowering = rng() < 0.055;
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(t.x, t.h - 0.5, t.z);
      s.set(trunkW, trunkH, trunkW);
      m.compose(p, q, s);
      trunkMesh.setMatrixAt(i, m);
      c.copy(C('#6b5640')).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      trunkMesh.setColorAt(i, c);

      const baseR = randRange(rng, 4.2, 7.6) * t.scale;
      for (let k = 0; k < 3; k++) {
        const r = baseR * (1 - k * 0.14) * randRange(rng, 0.82, 1.12);
        const ox = (rng() - 0.5) * baseR * 0.72;
        const oz = (rng() - 0.5) * baseR * 0.72;
        const oy = trunkH * (0.9 + k * 0.11) + (rng() - 0.5) * 1.2;
        e.set(rng() * 0.3, rng() * Math.PI * 2, rng() * 0.3);
        q.setFromEuler(e);
        p.set(t.x + ox, t.h + oy, t.z + oz);
        s.set(r, r * randRange(rng, 0.7, 0.95), r * randRange(rng, 0.88, 1.1));
        m.compose(p, q, s);
        canopyMesh.setMatrixAt(ci, m);
        c.copy(flowering ? blossomColors[Math.floor(rng() * blossomColors.length)] : colors[Math.floor(rng() * colors.length)]);
        c.offsetHSL((rng() - 0.5) * 0.018, 0, (rng() - 0.5) * 0.055);
        canopyMesh.setColorAt(ci, c);
        ci++;
      }
    });

    this.scene.add(trunkMesh);
    this.scene.add(canopyMesh);
    this.treeMeshes = [trunkMesh, canopyMesh];
  }

  _createForestDetails() {
    const rng = mulberry32(74123);
    const group = new THREE.Group();
    const blocked = (x, z) => (
      Math.hypot(x - 40, z + 150) < 44      // Elder Tree glade
      || Math.hypot(x - 150, z - 90) < 54   // village
      || Math.hypot(x - 20, z - 220) < 48   // start clearing
      || Math.hypot(x + 370, z - 168) < 30  // spawn over the lake
    );

    // --- pines: a darker, taller counterpoint to the round broadleaf canopy ---
    const pineCount = this.lowQuality ? 110 : 240;
    const pines = [];
    let tries = 0;
    while (pines.length < pineCount && tries < pineCount * 20) {
      tries++;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 540;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 10) continue;
      if (slopeAt(x, z) > 0.68) continue;
      if (blocked(x, z)) continue;
      // pines cluster on the higher slopes, leaving the meadows open
      if (h < 62 && rng() < 0.72) continue;
      if (rng() < 0.25 && Math.hypot(x, z) < 180) continue;
      pines.push({ x, z, h, scale: randRange(rng, 0.7, 1.55) });
    }

    const pineTrunkGeo = new THREE.CylinderGeometry(0.42, 0.72, 1, 5, 1);
    pineTrunkGeo.translate(0, 0.5, 0);
    const pineTierGeo = new THREE.ConeGeometry(1, 1, this.lowQuality ? 5 : 7, 1);
    const pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const pineMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: this.gradient,
      roughness: 1,
      emissive: C('#162a22'),
      emissiveIntensity: 0.1,
    });

    const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, pineTrunkMat, pines.length);
    const pineTiers = new THREE.InstancedMesh(pineTierGeo, pineMat, pines.length * 4);
    pineTrunks.castShadow = true;
    pineTrunks.receiveShadow = true;
    pineTiers.castShadow = true;
    pineTiers.receiveShadow = true;

    const pineColors = [C('#2c4a3b'), C('#355844'), C('#3d654b'), C('#274238'), C('#456f51'), C('#31503f')];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let ti = 0;

    pines.forEach((t, i) => {
      const height = randRange(rng, 12, 21) * t.scale;
      const trunkH = height * randRange(rng, 0.3, 0.4);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(t.x, t.h - 0.6, t.z);
      s.set(t.scale * randRange(rng, 0.75, 1.1), trunkH, t.scale * randRange(rng, 0.75, 1.1));
      m.compose(p, q, s);
      pineTrunks.setMatrixAt(i, m);
      c.copy(C('#5b4534')).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      pineTrunks.setColorAt(i, c);

      const baseColor = pineColors[Math.floor(rng() * pineColors.length)];
      for (let k = 0; k < 4; k++) {
        const f = k / 3;
        const radius = height * (0.27 - f * 0.062) * randRange(rng, 0.86, 1.1);
        const tierH = height * (0.36 - f * 0.05);
        const y = t.h + trunkH * 0.45 + f * height * 0.235;
        e.set(0, rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        p.set(t.x + (rng() - 0.5) * 0.5, y + tierH * 0.5, t.z + (rng() - 0.5) * 0.5);
        s.set(radius, tierH, radius * randRange(rng, 0.9, 1.08));
        m.compose(p, q, s);
        pineTiers.setMatrixAt(ti, m);
        c.copy(baseColor).offsetHSL((rng() - 0.5) * 0.015, 0, (rng() - 0.5) * 0.05 + f * 0.025);
        pineTiers.setColorAt(ti, c);
        ti++;
      }
    });

    group.add(pineTrunks, pineTiers);

    // --- boulders scattered across the meadows and slopes ---
    const rockCount = this.lowQuality ? 60 : 140;
    const rockGeo = new THREE.IcosahedronGeometry(1, this.lowQuality ? 0 : 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    const rockColors = [C('#8b8d83'), C('#9a988a'), C('#7c8178'), C('#a39d8b'), C('#6f766f')];
    let placed = 0;
    tries = 0;
    while (placed < rockCount && tries < rockCount * 24) {
      tries++;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 470;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 4) continue;
      if (blocked(x, z)) continue;
      const size = randRange(rng, 1.4, 4.8);
      e.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
      q.setFromEuler(e);
      p.set(x, h + size * 0.24, z);
      s.set(size * randRange(rng, 0.8, 1.3), size * randRange(rng, 0.55, 0.9), size * randRange(rng, 0.8, 1.3));
      m.compose(p, q, s);
      rocks.setMatrixAt(placed, m);
      c.copy(rockColors[Math.floor(rng() * rockColors.length)]).offsetHSL(0, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.06);
      rocks.setColorAt(placed, c);
      placed++;
    }
    rocks.count = placed;
    group.add(rocks);

    // --- low shrubs / bracken to soften the meadow-to-forest edges ---
    const shrubCount = this.lowQuality ? 180 : 420;
    const shrubGeo = new THREE.IcosahedronGeometry(1, 1);
    const shrubMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: this.gradient,
      roughness: 1,
      emissive: C('#20351f'),
      emissiveIntensity: 0.07,
    });
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubCount);
    shrubs.castShadow = true;
    shrubs.receiveShadow = true;
    const shrubColors = [C('#5a8447'), C('#6e9a52'), C('#4b7440'), C('#7fa75c'), C('#638c4d')];
    placed = 0;
    tries = 0;
    while (placed < shrubCount && tries < shrubCount * 20) {
      tries++;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 430;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 5) continue;
      if (slopeAt(x, z) > 0.6) continue;
      if (blocked(x, z)) continue;
      const size = randRange(rng, 1.1, 3.0);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(x, h + size * 0.32, z);
      s.set(size * randRange(rng, 0.9, 1.4), size * randRange(rng, 0.5, 0.8), size * randRange(rng, 0.9, 1.4));
      m.compose(p, q, s);
      shrubs.setMatrixAt(placed, m);
      c.copy(shrubColors[Math.floor(rng() * shrubColors.length)]).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.05);
      shrubs.setColorAt(placed, c);
      placed++;
    }
    shrubs.count = placed;
    group.add(shrubs);

    this.scene.add(group);
    this.forestDetails = group;
  }

  _createFlowers() {
    const rng = mulberry32(5301);
    const count = this.lowQuality ? 900 : 2200;
    const positions = [];
    const colors = [];
    const palette = [C('#f4e9b0'), C('#eec5cc'), C('#f7f1dc'), C('#d8c56f'), C('#c9d8a0')];
    const c = new THREE.Color();
    let tries = 0;
    while (positions.length < count * 3 && tries < count * 20) {
      tries++;
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 300;
      const x = Math.cos(a) * rr + 20;
      const z = Math.sin(a) * rr + 70;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 5 || slopeAt(x, z) > 0.4) continue;
      positions.push(x, h + 0.55, z);
      c.copy(palette[Math.floor(rng() * palette.length)]);
      colors.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.15,
      map: this.dotTexture,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.25,
      depthWrite: true,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.flowers = points;
  }

  _createVillage() {
    const rng = mulberry32(88012);
    const group = new THREE.Group();
    const houseData = [
      [128, 88, 0.35], [152, 108, -0.2], [110, 112, 0.8], [172, 78, 0.1],
      [138, 62, -0.5], [96, 74, 0.4], [158, 128, 0.2],
    ];
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe7dbc0, roughness: 0.9, flatShading: false });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x5c4633, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x9d5a3f, roughness: 0.9, flatShading: true });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b8574, roughness: 1 });

    houseData.forEach(([x, z, rot], i) => {
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 4) return;
      const w = randRange(rng, 7, 11);
      const d = randRange(rng, 7, 10);
      const wallH = randRange(rng, 5.5, 8);
      const house = new THREE.Group();
      house.position.set(x, h, z);
      house.rotation.y = rot;

      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 2, d * 1.06), stoneMat);
      base.position.y = 1;
      base.receiveShadow = true;
      base.castShadow = true;
      house.add(base);

      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      walls.position.y = 2 + wallH / 2;
      walls.castShadow = true;
      walls.receiveShadow = true;
      house.add(walls);

      // dark timber frame
      const beamGeo = new THREE.BoxGeometry(w * 1.01, 0.24, 0.24);
      for (let k = 0; k < 3; k++) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(0, 2.8 + k * (wallH / 3), d / 2 + 0.07);
        house.add(beam);
        const beam2 = beam.clone();
        beam2.position.z = -d / 2 - 0.07;
        house.add(beam2);
      }

      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.84, randRange(rng, 4.5, 7), 4), roofMat);
      roof.position.y = 2 + wallH + 2.2;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      roof.receiveShadow = true;
      house.add(roof);

      const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.4, 1.2), stoneMat);
      chimney.position.set(w * 0.24, 2 + wallH + 3.2, -d * 0.16);
      chimney.castShadow = true;
      house.add(chimney);

      // warm windows
      const winMat = new THREE.MeshBasicMaterial({ color: 0xffdd99, transparent: true, opacity: 0.9 });
      const winGeo = new THREE.PlaneGeometry(1.15, 1.5);
      for (let k = 0; k < 2; k++) {
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(-w * 0.22 + k * w * 0.44, 2 + wallH * 0.55, d / 2 + 0.06);
        house.add(win);
      }
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.8), beamMat);
      door.position.set(0, 2 + 1.4, d / 2 + 0.06);
      house.add(door);

      group.add(house);
    });

    // windmill on the ridge above the village
    const wx = 94;
    const wz = 40;
    const wh = terrainHeight(wx, wz);
    const mill = new THREE.Group();
    mill.position.set(wx, wh, wz);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 5.4, 22, 8), wallMat);
    tower.position.y = 11;
    tower.castShadow = true;
    tower.receiveShadow = true;
    mill.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4.6, 5, 8), roofMat);
    cap.position.y = 24.4;
    cap.castShadow = true;
    mill.add(cap);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2, 8), beamMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 21.5, 3.4);
    mill.add(hub);
    const blades = new THREE.Group();
    blades.position.set(0, 21.5, 4.6);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 0.3), beamMat);
      arm.position.set(0, 0, 0);
      arm.geometry.translate(0, 7.5, 0);
      arm.rotation.z = (i * Math.PI) / 2;
      arm.castShadow = true;
      blades.add(arm);
      const sail = new THREE.Mesh(new THREE.BoxGeometry(3.3, 11, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8ceb4, roughness: 1, side: THREE.DoubleSide }));
      sail.position.set(1.6, 8, 0.1);
      const holder = new THREE.Group();
      holder.rotation.z = (i * Math.PI) / 2;
      holder.add(sail);
      blades.add(holder);
    }
    mill.add(blades);
    this.windmillBlades = blades;
    group.add(mill);

    // a few fences
    const postMat = beamMat;
    for (let i = 0; i < 22; i++) {
      const x = 112 + i * 2.3;
      const z = 138 + Math.sin(i * 0.4) * 2.5;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 4) continue;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), postMat);
      post.position.set(x, h + 1.2, z);
      post.castShadow = true;
      group.add(post);
    }

    group.traverse((o) => {
      if (o.isMesh) o.frustumCulled = true;
    });
    this.scene.add(group);
    this.village = group;
  }

  _createGreatTree() {
    const gx = 40;
    const gz = -150;
    const gh = terrainHeight(gx, gz);
    const group = new THREE.Group();
    group.position.set(gx, gh, gz);

    const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b513b, roughness: 1, flatShading: true });
    const trunkGeo = new THREE.CylinderGeometry(3.4, 12.5, 112, 12, 7);
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const bend = Math.sin((y + 56) * 0.045) * (1 - Math.max(y, 0) / 70) * 1.6;
      tp.setX(i, tp.getX(i) + bend);
      tp.setZ(i, tp.getZ(i) + Math.cos(y * 0.05) * 0.7);
    }
    trunkGeo.computeVertexNormals();
    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.position.y = 56;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    // roots
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 3.2, 22, 6), barkMat);
      root.position.set(Math.cos(a) * 10, 4, Math.sin(a) * 10);
      root.rotation.z = Math.cos(a) * 0.8;
      root.rotation.x = Math.sin(a) * 0.8;
      root.castShadow = true;
      group.add(root);
    }

    // main branches
    const branchDirs = [
      [1, 0.4, 0.2, 0.8], [-1, 0.5, 0.25, 0.9], [0.2, 0.6, -1, 0.75], [-0.3, 0.5, 1, 0.65],
    ];
    branchDirs.forEach(([bx, by, bz, len]) => {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 42 * len, 7), barkMat);
      br.position.set(bx * 11, 78 + by * 14, bz * 11);
      br.rotation.z = -bx * 0.75;
      br.rotation.x = bz * 0.7;
      br.castShadow = true;
      group.add(br);
    });

    // canopy: layered clouds of leaves
    this.treeCanopies = [];
    const rng = mulberry32(3221);
    const greens = [C('#4f7a46'), C('#5e8b4e'), C('#709a58'), C('#3f6a43'), C('#87a963'), C('#a3b970')];
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const rad = randRange(rng, 3, 52);
      const y = randRange(rng, 76, 156) + (1 - rad / 54) * 10;
      const scale = randRange(rng, 16, 31) * (1 - rad / 110);
      const mat = new THREE.MeshToonMaterial({
        color: greens[i % greens.length].clone(),
        gradientMap: this.gradient,
        emissive: C('#1b2c1a'),
        emissiveIntensity: 0.12,
      });
      const blob = new THREE.Mesh(blobGeo, mat);
      blob.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      blob.scale.set(scale * randRange(rng, 0.9, 1.25), scale * randRange(rng, 0.62, 0.82), scale * randRange(rng, 0.9, 1.2));
      blob.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.3);
      blob.castShadow = true;
      blob.receiveShadow = true;
      group.add(blob);
      this.treeCanopies.push({
        mesh: blob,
        baseColor: mat.color.clone(),
        baseScale: blob.scale.clone(),
      });
    }

    // torii at the roots
    const redMat = new THREE.MeshStandardMaterial({ color: 0xb64e36, roughness: 0.8, flatShading: true });
    const torii = new THREE.Group();
    torii.position.set(0, 0, 22);
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 16, 7), redMat);
    postL.position.set(-5.2, 8, 0);
    const postR = postL.clone();
    postR.position.x = 5.2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(16, 1.3, 1.2), redMat);
    top.position.y = 16.2;
    top.rotation.z = 0;
    const top2 = new THREE.Mesh(new THREE.BoxGeometry(13, 0.9, 1), redMat);
    top2.position.y = 13.6;
    [postL, postR, top, top2].forEach((m) => { m.castShadow = true; torii.add(m); });
    group.add(torii);

    group.scale.set(1.22, 1.16, 1.22);
    this.scene.add(group);
    this.greatTree = group;
    this.greatTreeTop = new THREE.Vector3(gx, gh + 176, gz);

    // subtle warm light that wakes with the tree
    this.treeLight = new THREE.PointLight(0xffd69a, 0, 280, 2);
    this.treeLight.position.copy(this.greatTreeTop);
    this.scene.add(this.treeLight);
  }

  _createFloatingIslands() {
    const makeIsland = (x, y, z, radius) => {
      const group = new THREE.Group();
      group.position.set(x, y, z);

      const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a8f79, roughness: 1, flatShading: true, emissive: 0x2c2a23, emissiveIntensity: 0.25 });
      const topMat = new THREE.MeshStandardMaterial({ color: 0x6f8f4e, roughness: 1 });
      const deepMat = new THREE.MeshStandardMaterial({ color: 0x7d7363, roughness: 1, flatShading: true, emissive: 0x322e26, emissiveIntensity: 0.3 });

      const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, 3.2, 26, 1), topMat);
      top.position.y = 0;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.99, 1.2, 6, 28), rockMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -1.2;
      group.add(rim);

      const rockGeo = new THREE.ConeGeometry(radius * 0.95, radius * 2.15, 13, 5, false);
      const rp = rockGeo.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const vx = rp.getX(i);
        const vy = rp.getY(i);
        const vz = rp.getZ(i);
        const n = fbm(vx * 0.08 + 4.1, vz * 0.08 + vy * 0.04, 3) - 0.5;
        const t = clamp((radius * 1.05 - vy) / (radius * 2.1), 0, 1);
        rp.setX(i, vx * (1 + n * 0.16 * t));
        rp.setZ(i, vz * (1 + n * 0.16 * t));
        rp.setY(i, vy + n * 2.0 * t);
      }
      rockGeo.computeVertexNormals();
      const rock = new THREE.Mesh(rockGeo, deepMat);
      rock.position.y = -radius * 1.06 - 1.5;
      rock.rotation.z = Math.PI;
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);

      // hanging vines
      const vineMat = new THREE.MeshStandardMaterial({ color: 0x4e6b3d, roughness: 1, side: THREE.DoubleSide });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const len = 9 + this.rng() * 20;
        const vine = new THREE.Mesh(new THREE.PlaneGeometry(0.5, len), vineMat);
        vine.position.set(Math.cos(a) * radius * 0.92, -len / 2 - 1, Math.sin(a) * radius * 0.92);
        vine.rotation.y = a;
        group.add(vine);
      }

      // trees
      for (let i = 0; i < 4; i++) {
        const a = this.rng() * Math.PI * 2;
        const rr = this.rng() * radius * 0.55;
        const tx = Math.cos(a) * rr;
        const tz = Math.sin(a) * rr;
        const th = 12 + this.rng() * 8;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, th, 6), new THREE.MeshStandardMaterial({ color: 0x634b37, roughness: 1, flatShading: true }));
        trunk.position.set(tx, 1.6 + th / 2, tz);
        trunk.castShadow = true;
        group.add(trunk);
        for (let k = 0; k < 3; k++) {
          const r = 4.5 + this.rng() * 3;
          const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshToonMaterial({
            color: new THREE.Color().setHSL(0.27 + this.rng() * 0.04, 0.32, 0.34 + this.rng() * 0.12),
            gradientMap: this.gradient,
          }));
          blob.position.set(tx + (this.rng() - 0.5) * 6, 1.6 + th + k * 3.2 + this.rng() * 2, tz + (this.rng() - 0.5) * 6);
          blob.castShadow = true;
          group.add(blob);
        }
      }

      // a little waterfall spilling into the sky
      const fallMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.92 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */`
          uniform float uTime; uniform float uOpacity; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(41.2, 289.1))) * 43758.5); }
          float noise(vec2 p){
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
          }
          void main(){
            float n = noise(vec2(vUv.x * 18.0, vUv.y * 4.0 + uTime * 2.2));
            float n2 = noise(vec2(vUv.x * 40.0 + 4.0, vUv.y * 10.0 + uTime * 4.0));
            float streak = smoothstep(0.42, 0.8, n * 0.7 + n2 * 0.5);
            float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
            float fade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            vec3 col = mix(vec3(0.62, 0.80, 0.84), vec3(0.96, 0.99, 1.0), streak);
            gl_FragColor = vec4(col, streak * edge * fade * uOpacity);
          }
        `,
      });
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(8, 96), fallMat);
      fall.position.set(radius * 0.52, -48, radius * 0.66);
      fall.rotation.y = -0.5;
      group.add(fall);

      const mist = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture, color: 0xe9fbff, transparent: true, opacity: 0.42,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      mist.scale.setScalar(38);
      mist.position.set(radius * 0.52, -92, radius * 0.66);
      group.add(mist);

      group.userData.fall = fall;
      this.scene.add(group);
      this.islands.push({ group, x, y, z, radius, fall, mist });
    };

    makeIsland(-554, 252, -452, 38);
    makeIsland(586, 268, -342, 44);
  }

  _createClouds() {
    const rng = mulberry32(7777);
    this.clouds = [];
    const puffGeo = new THREE.SphereGeometry(1, 14, 10);
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSunColor: { value: C('#ffdaa6') },
        uShade: { value: C('#93a9be') },
        uLit: { value: C('#fff6e6') },
        uFogColor: { value: this.fogColor },
        uFogDensity: { value: 0.00055 },
      },
      vertexShader: /* glsl */`
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          vec3 n = normalize(position);
          vNormalW = normalize(mat3(modelMatrix) * n);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uShade;
        uniform vec3 uLit;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec3 vNormalW;
        varying vec3 vWorld;

        void main() {
          vec3 N = normalize(vNormalW);
          vec3 V = normalize(cameraPosition - vWorld);
          float ndl = max(dot(N, uSunDir), 0.0);
          float wrap = clamp((ndl + 0.32) / 1.32, 0.0, 1.0);
          vec3 col = mix(uShade, uLit, smoothstep(0.06, 0.78, wrap));
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.8);
          col += uSunColor * rim * 0.20 * smoothstep(0.0, 0.55, ndl);
          col += uLit * 0.035;

          float dist = length(cameraPosition - vWorld);
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const hazeTex = makeCloudTexture();

    const defs = [
      [-240, 224, -330, 1.35], [180, 248, -360, 1.2], [420, 238, -120, 1.1],
      [-430, 210, 160, 1.2], [330, 215, 250, 0.95], [-100, 270, 380, 1.0],
      [40, 305, -520, 1.4], [-520, 285, -320, 1.1], [530, 295, 180, 0.95],
      [250, 262, -70, 1.12], [-640, 250, 60, 1.0],
    ];

    defs.forEach(([cx, cy, cz, scale]) => {
      const group = new THREE.Group();
      group.position.set(cx, cy, cz);
      const puffs = 17 + Math.floor(rng() * 9);
      const width = 46 * scale;
      for (let i = 0; i < puffs; i++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.pow(rng(), 0.52) * width;
        const lift = Math.pow(rng(), 0.8);
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        const s = (15 + (1 - rr / width) * 13 + rng() * 13) * scale;
        puff.position.set(
          Math.cos(a) * rr,
          (lift * 22 - (rr / width) * 6 - 5) * scale,
          Math.sin(a) * rr * 0.72,
        );
        puff.scale.set(s * (0.86 + rng() * 0.5), s * (0.6 + rng() * 0.34), s * (0.86 + rng() * 0.5));
        puff.rotation.set(rng() * 0.3, rng() * Math.PI, rng() * 0.3);
        puff.castShadow = false;
        puff.receiveShadow = false;
        group.add(puff);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: hazeTex, color: 0xfff2da, transparent: true, opacity: 0.14,
        depthWrite: false, fog: true,
      }));
      halo.scale.set(250 * scale, 130 * scale, 1);
      halo.position.y = 4;
      group.add(halo);
      this.scene.add(group);
      this.clouds.push({ group, speed: 0.6 + rng() * 1.2, drift: rng() * Math.PI * 2 });
    });

    // pale banks resting on the far horizon
    const bankDefs = [
      [-900, 140, -900, 420, 130, 0.24], [800, 155, -700, 460, 150, 0.22],
      [-1150, 150, 200, 400, 130, 0.18], [500, 135, 950, 470, 150, 0.2],
    ];
    bankDefs.forEach(([x, y, z, w, h, o]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: hazeTex, color: 0xfff0d8, transparent: true, opacity: o, depthWrite: false, fog: true,
      }));
      sp.position.set(x, y, z);
      sp.scale.set(w, h, 1);
      this.scene.add(sp);
    });
  }

  _createGates() {
    const gateGeo = new THREE.TorusGeometry(7.4, 0.26, 8, 72);
    const innerGeo = new THREE.TorusGeometry(6.55, 0.07, 6, 64);
    const streamerGeo = new THREE.PlaneGeometry(0.42, 3.6);
    const wispGeo = new THREE.SphereGeometry(0.9, 16, 12);
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xffe4a6, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const wispMat = new THREE.MeshBasicMaterial({ color: 0xffdca0, toneMapped: true });
    const streamerMat = new THREE.MeshBasicMaterial({
      color: 0xf7dfb0, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffc97a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: true,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffe3b0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: true,
    });

    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: C('#ffe6b0') }, uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime; uniform float uOpacity;
        varying vec2 vUv;
        void main(){
          float v = vUv.y;
          float a = pow(1.0 - v, 3.0) * 0.055;
          a += smoothstep(0.95, 0.2, v) * 0.008;
          a *= 0.8 + 0.2 * sin(uTime * 1.6 + v * 10.0);
          gl_FragColor = vec4(uColor, a * uOpacity);
        }
      `,
    });

    GATE_DEFS.forEach((def, i) => {
      const [x, baseY, z] = def.pos;
      const ground = terrainHeight(x, z);
      const y = Math.max(baseY, ground + 26, WATER_LEVEL + 18);

      const container = new THREE.Group();
      container.position.set(x, y, z);

      const ring = new THREE.Group();
      const prev = i === 0 ? START_POSITION : new THREE.Vector3(...GATE_DEFS[i - 1].pos);
      const facing = new THREE.Vector3(prev.x - x, prev.y - y, prev.z - z).normalize();
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
      container.add(ring);

      const torus = new THREE.Mesh(gateGeo, ringMat);
      ring.add(torus);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.rotation.z = 0.4;
      ring.add(inner);

      const halo = new THREE.Sprite(glowMat.clone());
      halo.material.opacity = 0.26;
      halo.scale.setScalar(13);
      halo.position.z = -0.6;
      ring.add(halo);

      // paper streamers tied to the ring
      const streamers = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const s = new THREE.Mesh(streamerGeo, streamerMat);
        s.position.set(Math.cos(a) * 7.5, Math.sin(a) * 7.5, 0);
        s.rotation.z = a + Math.PI / 2;
        s.rotation.y = 0.2;
        ring.add(s);
        streamers.push({ mesh: s, phase: this.rng() * Math.PI * 2 });
      }

      const wisp = new THREE.Mesh(wispGeo, wispMat);
      const wispGlow = new THREE.Sprite(glowMat.clone());
      wispGlow.material.opacity = 0.6;
      wispGlow.scale.setScalar(5.5);
      wisp.add(wispGlow);
      ring.add(wisp);

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.7, 300, 10, 1, true), beamMat.clone());
      beam.position.y = 120;
      beam.renderOrder = 2;
      container.add(beam);

      this.scene.add(container);
      this.gates.push({
        index: i,
        name: def.name,
        position: new THREE.Vector3(x, y, z),
        container,
        ring,
        torus,
        inner,
        halo,
        wisp,
        wispGlow,
        beam,
        streamers,
        collected: false,
        phase: this.rng() * Math.PI * 2,
      });
    });
  }

  _createPollen() {
    const rng = mulberry32(9291);
    const count = this.lowQuality ? 240 : 480;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() - 0.5) * 120;
      positions[i * 3 + 1] = (rng() - 0.5) * 82;
      positions[i * 3 + 2] = (rng() - 0.5) * 120;
      speeds[i] = 0.25 + rng() * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe8b0,
      size: 0.55,
      map: this.dotTexture,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.pollen = points;
    this.pollenSpeeds = speeds;
  }

  _createFlock() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x47544a });
    const wingMat = new THREE.MeshBasicMaterial({ color: 0x5b6858, side: THREE.DoubleSide });
    const birds = [];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 5), bodyMat);
      body.rotation.x = -Math.PI / 2;
      b.add(body);
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), wingMat);
      wl.position.x = -1.6;
      wl.rotation.x = -Math.PI / 2;
      const wr = wl.clone();
      wr.position.x = 1.6;
      b.add(wl, wr);
      const row = Math.ceil(i / 2);
      const side = i === 0 ? 0 : i % 2 === 0 ? 1 : -1;
      b.position.set(side * row * 3.4, (this.rng() - 0.5) * 2, row * 3.1);
      b.userData = { wl, wr, phase: this.rng() * 10 };
      group.add(b);
      birds.push(b);
    }
    group.position.set(-150, 155, 10);
    this.scene.add(group);
    this.flock = { group, birds, angle: 0 };
  }

  collectGate(gate) {
    if (gate.collected) return false;
    gate.collected = true;
    gate.container.visible = false;
    this.collected++;
    return true;
  }

  awakenTree() {
    if (this.blooming) return;
    this.blooming = true;
    this.bloomProgress = 0;
    this._createPetals();
  }

  _createPetals() {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const rng = mulberry32(1992);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 100;
      positions[i * 3] = this.greatTree.position.x + Math.cos(a) * r;
      positions[i * 3 + 1] = this.greatTree.position.y + 100 + rng() * 100;
      positions[i * 3 + 2] = this.greatTree.position.z + Math.sin(a) * r;
      seed[i] = rng() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.7,
      map: this.petalTexture,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      alphaTest: 0.05,
      color: 0xffffff,
    });
    const petals = new THREE.Points(geo, mat);
    petals.frustumCulled = false;
    this.scene.add(petals);
    this.petals = { points: petals, seed };
  }

  reset() {
    this.collected = 0;
    this.blooming = false;
    this.bloomProgress = 0;
    this.gates.forEach((g) => {
      g.collected = false;
      g.container.visible = true;
      g.container.scale.setScalar(1);
    });
    if (this.petals) {
      this.scene.remove(this.petals.points);
      this.petals.points.geometry.dispose();
      this.petals.points.material.dispose();
      this.petals = null;
    }
    this.treeLight.intensity = 0;
    this.treeCanopies.forEach((t) => {
      t.mesh.material.color.copy(t.baseColor);
      t.mesh.material.emissive.set('#1b2c1a');
      t.mesh.material.emissiveIntensity = 0.12;
      t.mesh.scale.copy(t.baseScale);
    });
    this.treeBloom = 0;
  }

  nearestGate(from) {
    let best = null;
    let bestD = Infinity;
    for (const g of this.gates) {
      if (g.collected) continue;
      const d = from.distanceTo(g.position);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best ? { gate: best, distance: bestD } : null;
  }

  hitIsland(p) {
    for (const is of this.islands) {
      const dx = p.x - is.x;
      const dz = p.z - is.z;
      if (dx * dx + dz * dz < (is.radius * 0.92) ** 2 && p.y < is.y + 2 && p.y > is.y - is.radius * 2.0) return true;
    }
    return false;
  }

  update(dt, time, birdPos, playerActive) {
    this.time = time;
    this.skyUniforms.uTime.value = time;
    this.waterUniforms.uTime.value = time;

    // sun & shadows follow the bird so nearby ground detail stays crisp
    const focus = birdPos;
    this.sunLight.position.set(focus.x + this.sunDir.x * 330, focus.y + this.sunDir.y * 330, focus.z + this.sunDir.z * 330);
    this.sunLight.target.position.set(focus.x, Math.max(focus.y - 120, 40), focus.z);
    this.sunLight.target.updateMatrixWorld();

    // clouds drift
    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      c.group.position.z += Math.sin(time * 0.04 + c.drift) * 0.16 * dt;
      if (c.group.position.x > 900) c.group.position.x = -900;
    }

    if (this.windmillBlades) this.windmillBlades.rotation.z += dt * 0.34;

    // gates breathe
    for (const g of this.gates) {
      if (g.collected) continue;
      const pulse = Math.sin(time * 1.2 + g.phase) * 0.5 + 0.5;
      g.halo.material.opacity = 0.18 + pulse * 0.14;
      g.halo.scale.setScalar(12 + pulse * 2.5);
      g.inner.rotation.z += dt * 0.22;
      g.wisp.position.y = Math.sin(time * 1.35 + g.phase) * 0.9;
      g.wisp.rotation.y += dt * 0.5;
      g.wispGlow.scale.setScalar(5.5 + pulse * 1.8);
      g.beam.material.uniforms.uTime.value = time;
      const beamFade = 1 - smoothstep(300, 640, birdPos.distanceTo(g.position));
      g.beam.material.uniforms.uOpacity.value = (0.55 + pulse * 0.35) * beamFade;
      g.beam.visible = beamFade > 0.02;
      g.streamers.forEach((s, k) => {
        s.mesh.rotation.y = 0.2 + Math.sin(time * 1.9 + s.phase) * 0.22;
        s.mesh.rotation.z = 0.2 * Math.sin(time * 2.4 + k);
      });
    }

    // floating islands
    for (const is of this.islands) {
      is.group.position.y = is.y + Math.sin(time * 0.25 + is.x * 0.01) * 1.6;
      is.fall.material.uniforms.uTime.value = time;
      is.mist.material.opacity = 0.32 + Math.sin(time * 0.8 + is.z) * 0.08;
    }

    // pollen drifts with the player
    if (this.pollen) {
      this.pollen.position.copy(birdPos);
      const arr = this.pollen.geometry.attributes.position.array;
      const sp = this.pollenSpeeds;
      for (let i = 0; i < sp.length; i++) {
        const ix = i * 3;
        arr[ix] += Math.sin(time * 0.35 + i) * 0.012 + 0.018 * sp[i];
        arr[ix + 1] += (0.02 + sp[i] * 0.03) * 0.25;
        arr[ix + 2] += Math.cos(time * 0.28 + i * 0.7) * 0.012;
        if (arr[ix] > 76) arr[ix] = -76;
        if (arr[ix] < -76) arr[ix] = 76;
        if (arr[ix + 1] > 58) arr[ix + 1] = -58;
        if (arr[ix + 1] < -58) arr[ix + 1] = 58;
        if (arr[ix + 2] > 76) arr[ix + 2] = -76;
        if (arr[ix + 2] < -76) arr[ix + 2] = 76;
      }
      this.pollen.geometry.attributes.position.needsUpdate = true;
    }

    // flock
    if (this.flock) {
      this.flock.angle += dt * 0.075;
      const a = this.flock.angle;
      this.flock.group.position.set(-150 + Math.cos(a) * 105, 155 + Math.sin(a * 1.8) * 9, 10 + Math.sin(a) * 105);
      this.flock.group.rotation.y = -a + Math.PI / 2;
      this.flock.birds.forEach((b) => {
        const flap = Math.sin(time * 5.2 + b.userData.phase) * 0.5 + 0.5;
        b.userData.wl.rotation.y = -0.2 + flap * 0.55;
        b.userData.wr.rotation.y = 0.2 - flap * 0.55;
        b.position.y += Math.sin(time * 2.2 + b.userData.phase) * 0.002;
      });
    }

    // petals & bloom
    if (this.blooming) {
      this.bloomProgress = Math.min(1, this.bloomProgress + dt * 0.28);
      const t = this.bloomProgress;
      this.treeLight.intensity = t * 5.5;
      this.treeCanopies.forEach((c, i) => {
        const target = new THREE.Color().setHSL(0.94, 0.52, 0.74 + (i % 4) * 0.035);
        c.mesh.material.color.copy(c.baseColor).lerp(target, smoothstep(0, 1, t));
        c.mesh.material.emissive.set('#e7a6b8');
        c.mesh.material.emissiveIntensity = t * 0.32;
        const s = 1 + Math.sin(t * Math.PI) * 0.08;
        c.mesh.scale.copy(c.baseScale).multiplyScalar(s);
      });
      if (this.petals) {
        const arr = this.petals.points.geometry.attributes.position.array;
        const seeds = this.petals.seed;
        for (let i = 0; i < seeds.length; i++) {
          const ix = i * 3;
          arr[ix] += Math.sin(time * 0.8 + seeds[i]) * dt * 2.2 + dt * 1.1;
          arr[ix + 1] -= dt * (1.3 + (seeds[i] % 1.7));
          arr[ix + 2] += Math.cos(time * 0.6 + seeds[i] * 1.3) * dt * 2.0;
          if (arr[ix + 1] < this.greatTree.position.y - 8) {
            arr[ix + 1] = this.greatTree.position.y + 130 + (seeds[i] % 70);
            arr[ix] = this.greatTree.position.x + (Math.random() - 0.5) * 150;
            arr[ix + 2] = this.greatTree.position.z + (Math.random() - 0.5) * 150;
          }
        }
        this.petals.points.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
}
