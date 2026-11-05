import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { World, START_POSITION, WATER_LEVEL, WORLD_EDGE } from './world.js';
import { Bird } from './bird.js';
import { Effects } from './effects.js';
import { Soundscape } from './audio.js';
import { clamp, damp, shortestAngle, smoothstep } from './utils.js';
import { makeGlowTexture } from './textures.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const lowQuality = params.get('quality') === 'low' || isMobile;

/* ------------------------------------------------------------------ */
/* renderer / scene                                                    */
/* ------------------------------------------------------------------ */

const canvas = $('scene');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 6000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1.35 : 1.65));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;

const world = new World(scene, renderer, { lowQuality });
const bird = new Bird(scene);
bird.world = world;

const glow = makeGlowTexture(128);
const effects = new Effects(scene, glow);
const sound = new Soundscape();

/* ------------------------------------------------------------------ */
/* post-processing                                                     */
/* ------------------------------------------------------------------ */

const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  lowQuality ? 0.32 : 0.42,
  0.72,
  0.94,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // a breath of lens softness at the edges
      vec3 col;
      col.r = texture2D(tDiffuse, uv - d * 0.0018 * r2).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + d * 0.0018 * r2).b;
      col *= 1.0 - r2 * 0.035;

      float l = dot(col, vec3(0.299, 0.587, 0.114));

      // warm honeyed highlights, cool blue-green shadows
      col = mix(col, col * vec3(1.035, 1.005, 0.94), smoothstep(0.42, 1.0, l));
      col = mix(col, col * vec3(0.93, 0.995, 1.045), smoothstep(0.34, 0.0, l));

      // gentle saturation & filmic contrast
      col = mix(vec3(l), col, 1.12);
      col = (col - 0.5) * 1.05 + 0.5;

      // edge vignette, soft like a painted frame
      float vig = smoothstep(0.92, 0.22, length(d) * 1.38);
      col *= mix(0.72, 1.0, vig);

      // paper grain
      float g = hash(uv * uResolution + vec2(uTime * 13.0));
      col += (g - 0.5) * 0.024;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);

const fxaaPass = new ShaderPass(FXAAShader);
const setFxaaResolution = () => {
  const px = renderer.getPixelRatio();
  fxaaPass.material.uniforms.resolution.value.set(
    1 / (window.innerWidth * px),
    1 / (window.innerHeight * px),
  );
};
setFxaaResolution();
composer.addPass(fxaaPass);

/* ------------------------------------------------------------------ */
/* game state                                                          */
/* ------------------------------------------------------------------ */

const state = {
  phase: 'menu', // menu | playing | paused | celebrating | complete
  started: false,
  completed: false,
  flightTime: 0,
  horse: 0, // total shader time
  best: parseFloat(localStorage.getItem('kaze-best') || '0') || 0,
  muted: localStorage.getItem('kaze-muted') === '1',
  celebration: 0,
  toastTimer: null,
  boundaryCooldown: 0,
  cameraSnap: true,
  collectedPulse: 0,
};

sound.muted = state.muted;
document.body.classList.toggle('muted', state.muted);

bird.reset(START_POSITION.x, START_POSITION.y, START_POSITION.z, -0.92);
bird.baseYaw = -0.92;
bird.model.scale.setScalar(0.86);
bird.pitch = -0.04;
bird.roll = 0;

/* ------------------------------------------------------------------ */
/* input                                                               */
/* ------------------------------------------------------------------ */

const keys = Object.create(null);
const touch = { turn: 0, pitch: 0, flap: false, boost: false };
let stickPointer = null;
let stickCenter = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  keys[e.code] = true;

  if (e.code === 'Escape') {
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeGame();
  }
  if (e.code === 'Enter' && state.phase === 'menu') startGame(true);
  if (e.code === 'Space' && state.phase === 'menu') startGame(true);
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (state.phase === 'playing') pauseGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.phase === 'playing') pauseGame();
});
window.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.touch-controls') || e.target === canvas) e.preventDefault();
});

function bindTouchControls() {
  const zone = $('stickZone');
  const base = $('stickBase');
  const knob = $('stickKnob');

  const updateStick = (e) => {
    if (!stickPointer || e.pointerId !== stickPointer) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * 0.36;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.turn = clamp(dx / max, -1, 1);
    touch.pitch = clamp(-dy / max, -1, 1);
  };

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickPointer = e.pointerId;
    zone.setPointerCapture?.(e.pointerId);
    updateStick(e);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) {
      e.preventDefault();
      updateStick(e);
    }
  });
  const endStick = (e) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    touch.turn = 0;
    touch.pitch = 0;
    knob.style.transform = 'translate(0px, 0px)';
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  const flapBtn = $('flapBtn');
  const diveBtn = $('diveBtn');
  const hold = (el, on, off) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('pressed');
      on();
    });
    const release = (e) => {
      e.preventDefault();
      el.classList.remove('pressed');
      off();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', (e) => {
      if (e.buttons === 0) release(e);
    });
  };
  hold(flapBtn, () => { touch.flap = true; }, () => { touch.flap = false; });
  hold(diveBtn, () => { touch.boost = true; }, () => { touch.boost = false; });
}
bindTouchControls();

function readInput() {
  let turn = 0;
  let pitch = 0;
  if (keys.KeyA || keys.ArrowLeft) turn -= 1;
  if (keys.KeyD || keys.ArrowRight) turn += 1;
  if (keys.KeyW || keys.ArrowUp) pitch += 1;
  if (keys.KeyS || keys.ArrowDown) pitch -= 1;
  turn = clamp(turn + touch.turn, -1, 1);
  pitch = clamp(pitch + touch.pitch, -1, 1);
  return {
    turn,
    pitch,
    flap: !!keys.Space || touch.flap,
    boost: !!keys.ShiftLeft || !!keys.ShiftRight || touch.boost,
  };
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const ui = {
  menu: $('menu'),
  hud: $('hud'),
  loading: $('loading'),
  startBtn: $('startBtn'),
  clock: $('clock'),
  spiritCount: $('spiritCount'),
  objFill: $('objFill'),
  guide: $('guide'),
  guideArrow: $('guideArrow'),
  guideName: $('guideName'),
  guideDist: $('guideDist'),
  windFill: $('windFill'),
  windPct: $('windPct'),
  windMeter: document.querySelector('.wind-meter'),
  windHint: $('windHint'),
  altitude: $('altitude'),
  airspeed: $('airspeed'),
  toast: $('toast'),
  toastName: $('toastName'),
  boundary: $('boundary'),
  pause: $('pause'),
  complete: $('complete'),
  finalTime: $('finalTime'),
  bestTime: $('bestTime'),
  touchControls: $('touchControls'),
  soundBtn: $('soundBtn'),
  flash: $('flash'),
  pauseBtn: $('pauseBtn'),
  resumeBtn: $('resumeBtn'),
  restartBtn: $('restartBtn'),
  restartBtnPause: $('restartBtnPause'),
  keepBtn: $('keepBtn'),
};

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function updateHud() {
  ui.clock.textContent = formatTime(state.flightTime);
  ui.spiritCount.textContent = String(world.collected);
  ui.objFill.style.width = `${(world.collected / world.gates.length) * 100}%`;

  const wind = clamp(bird.wind, 0, 1);
  ui.windFill.style.width = `${Math.round(wind * 100)}%`;
  ui.windPct.textContent = String(Math.round(wind * 100));
  ui.windMeter.classList.toggle('low', wind < 0.28);
  ui.windHint.textContent = wind < 0.25 ? 'glide a while — the wind returns' : 'gliding restores your wind';

  ui.altitude.textContent = String(Math.max(0, Math.round(bird.position.y - WATER_LEVEL)));
  ui.airspeed.textContent = String(Math.round(bird.speed * 3.6));
}

function showToast(kicker, name, time = 2600) {
  ui.toast.querySelector('.toast-kicker').textContent = kicker;
  ui.toastName.textContent = name;
  ui.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), time);
}

function flashScreen() {
  ui.flash.classList.add('show');
  setTimeout(() => ui.flash.classList.remove('show'), 120);
}

function refreshSoundButton() {
  document.body.classList.toggle('muted', state.muted);
}

ui.soundBtn.addEventListener('click', () => {
  state.muted = !state.muted;
  localStorage.setItem('kaze-muted', state.muted ? '1' : '0');
  sound.setMuted(state.muted);
  refreshSoundButton();
  if (!state.muted && state.phase !== 'menu') sound.start();
});

ui.startBtn.addEventListener('click', () => startGame(true));
ui.pauseBtn.addEventListener('click', () => pauseGame());
ui.resumeBtn.addEventListener('click', () => resumeGame());
ui.restartBtn.addEventListener('click', () => restartGame());
ui.restartBtnPause.addEventListener('click', () => restartGame());
ui.keepBtn.addEventListener('click', () => keepExploring());

/* ------------------------------------------------------------------ */
/* flow                                                                */
/* ------------------------------------------------------------------ */

function startGame(userGesture = false) {
  if (state.phase !== 'menu') return;
  state.phase = 'playing';
  state.started = true;
  state.flightTime = 0;
  state.completed = false;
  state.cameraSnap = true;
  ui.menu.classList.add('leaving');
  setTimeout(() => ui.menu.classList.add('hidden'), 950);
  ui.hud.classList.remove('hidden');
  if (isTouch) ui.touchControls.classList.remove('hidden');
  updateHud();
  if (userGesture && !state.muted) sound.start();
  showToast('The wind rises', 'Find the nine drifting spirits', 3600);
}

function pauseGame() {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  ui.pause.classList.remove('hidden');
  if (isTouch) ui.touchControls.classList.add('hidden');
}

function resumeGame() {
  if (state.phase !== 'paused') return;
  state.phase = 'playing';
  ui.pause.classList.add('hidden');
  if (isTouch) ui.touchControls.classList.remove('hidden');
}

function restartGame() {
  world.reset();
  bird.reset(START_POSITION.x, START_POSITION.y, START_POSITION.z, -0.92);
  bird.baseYaw = -0.92;
  bird.pitch = -0.04;
  state.phase = 'playing';
  state.completed = false;
  state.flightTime = 0;
  state.celebration = 0;
  state.cameraSnap = true;
  ui.pause.classList.add('hidden');
  ui.complete.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  if (isTouch) ui.touchControls.classList.remove('hidden');
  ui.guide.classList.remove('invisible');
  updateHud();
  showToast('Another flight', 'The valley is listening', 2600);
}

function beginCompletion() {
  if (state.completed) return;
  state.completed = true;
  state.phase = 'celebrating';
  state.celebration = 2.9;
  world.awakenTree();
  sound.complete();
  effects.burst(bird.position.clone(), 0xffd9a4, 70, 22, 2.3);
  effects.burst(world.greatTreeTop.clone(), 0xffc4d3, 90, 30, 3.2);
  ui.guide.classList.add('invisible');
  if (isTouch) ui.touchControls.classList.add('hidden');

  if (!state.best || state.flightTime < state.best) {
    state.best = state.flightTime;
    localStorage.setItem('kaze-best', String(state.best));
  }
  ui.finalTime.textContent = formatTime(state.flightTime);
  ui.bestTime.textContent = state.best ? formatTime(state.best) : '—';
}

function showComplete() {
  state.phase = 'complete';
  ui.complete.classList.remove('hidden');
}

function keepExploring() {
  ui.complete.classList.add('hidden');
  state.phase = 'playing';
  state.cameraSnap = false;
  if (isTouch) ui.touchControls.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

const camGoal = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camLookGoal = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpFwd = new THREE.Vector3();

function updateCamera(dt, time) {
  const menu = state.phase === 'menu';
  const phaseSlow = state.phase === 'paused' || state.phase === 'complete';
  const speed = bird.speed;

  camEuler.set(bird.pitch * 0.42, bird.yaw + (menu ? Math.sin(time * 0.055) * 0.24 : 0), bird.roll * 0.38);
  camQuat.setFromEuler(camEuler);

  const dist = menu ? 16.2 : 12.8 + clamp((speed - 24) * 0.055, -0.6, 2.6);
  const height = menu ? 3.7 : 4.0 + clamp((speed - 24) * 0.012, 0, 1.1);
  camGoal.set(0, height, dist).applyQuaternion(camQuat).add(bird.position);

  const ground = world.heightAt(camGoal.x, camGoal.z) + 3.5;
  if (camGoal.y < ground) camGoal.y = ground;

  const follow = state.cameraSnap ? 1 : 1 - Math.exp(-dt * (menu ? 5.2 : phaseSlow ? 3.4 : 8.5));
  camera.position.lerp(camGoal, follow);

  const ground2 = world.heightAt(camera.position.x, camera.position.z) + 3.2;
  if (camera.position.y < ground2) camera.position.y = ground2;

  bird.getForward(tmpFwd);
  if (menu) {
    camLookGoal.copy(bird.position).addScaledVector(tmpFwd, 10).add(new THREE.Vector3(0, 2.25, 0));
    // frame the bird to the right of the title card
    camLookGoal.x -= Math.cos(bird.yaw) * 6.2;
    camLookGoal.z += Math.sin(bird.yaw) * 6.2;
  } else {
    camLookGoal.copy(bird.position).addScaledVector(tmpFwd, 8 + speed * 0.03).add(new THREE.Vector3(0, 1.6, 0));
  }

  if (state.cameraSnap) camLook.copy(camLookGoal);
  else camLook.lerp(camLookGoal, 1 - Math.exp(-dt * 9));

  camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
  camera.rotateZ(-bird.roll * 0.17);

  // tiny wingbeat in the frame
  const shake = bird.flapTimer > 0 && state.phase === 'playing' ? bird.flapTimer * 0.05 : 0;
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.7;
  }

  const targetFov = menu ? 58 : 61 + clamp((speed - 23) * 0.52, -2.5, 20);
  camera.fov = damp(camera.fov, targetFov, 2.8, dt);
  camera.updateProjectionMatrix();
  state.cameraSnap = false;
}

/* ------------------------------------------------------------------ */
/* collision & collection                                              */
/* ------------------------------------------------------------------ */

let boundaryTimer = null;

function checkHazards(dt) {
  const g = world.heightAt(bird.position.x, bird.position.z);
  const floor = Math.max(g, WATER_LEVEL) + 3.1;
  bird.crashCooldown = Math.max(0, bird.crashCooldown - dt);

  let crashed = false;
  if (bird.position.y < floor) crashed = true;
  if (world.hitIsland(bird.position)) crashed = true;

  if (crashed && bird.crashCooldown <= 0) {
    bird.crashCooldown = 3.5;
    flashScreen();
    sound.windRush();
    showToast('A sudden gust', 'The wind lifts you back into the sky', 2300);
    bird.respawn(world);
    state.cameraSnap = true;
  }

  const r = Math.hypot(bird.position.x, bird.position.z);
  if (r > WORLD_EDGE) {
    const s = WORLD_EDGE / r;
    bird.position.x *= s;
    bird.position.z *= s;
    const toward = Math.atan2(bird.position.x, bird.position.z);
    bird.yaw += shortestAngle(bird.yaw, toward) * Math.min(1, dt * 1.3);
    if (state.boundaryCooldown <= 0) {
      state.boundaryCooldown = 6;
      ui.boundary.classList.add('show');
      clearTimeout(boundaryTimer);
      boundaryTimer = setTimeout(() => ui.boundary.classList.remove('show'), 2800);
    }
  }
  state.boundaryCooldown = Math.max(0, state.boundaryCooldown - dt);
}

let guideTimer = 0;

function checkGates(dt) {
  if (state.completed) return;
  for (const gate of world.gates) {
    if (gate.collected) continue;
    if (bird.position.distanceToSquared(gate.position) < 12.5 * 12.5) {
      if (world.collectGate(gate)) {
        effects.burst(gate.position.clone(), 0xffe4a8, 58, 18, 2.0);
        sound.collect(world.collected);
        state.collectedPulse = 1;
        updateHud();
        showToast('Spirit found', `${gate.name}  ·  ${world.collected} of ${world.gates.length}`, 3000);
        if (world.collected >= world.gates.length) beginCompletion();
      }
    }
  }

  guideTimer -= dt;
  if (guideTimer <= 0 && !state.completed) {
    guideTimer = 0.15;
    const nearest = world.nearestGate(bird.position);
    if (nearest) {
      ui.guide.classList.remove('invisible');
      ui.guideName.textContent = nearest.gate.name;
      ui.guideDist.textContent = `${Math.round(nearest.distance)} m`;
      const dx = nearest.gate.position.x - bird.position.x;
      const dz = nearest.gate.position.z - bird.position.z;
      const desired = Math.atan2(-dx, -dz);
      const rel = shortestAngle(bird.yaw, desired);
      ui.guideArrow.style.transform = `rotate(${-rel}rad)`;
    } else {
      ui.guide.classList.add('invisible');
    }
  }
}

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  gradePass.material.uniforms.uResolution.value.set(w, h);
  setFxaaResolution();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

/* ------------------------------------------------------------------ */
/* main loop                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let shaderTime = 0;
let frameCount = 0;
let guideVisible = false;
let lastGuideText = '';
let autoStarted = false;

function animate() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  shaderTime += dt;
  state.horse = shaderTime;

  let input = { turn: 0, pitch: 0, flap: false, boost: false };

  if (state.phase === 'menu') {
    bird.idle(dt);
  } else if (state.phase === 'playing') {
    input = readInput();
    bird.update(dt, input);
    checkHazards(dt);
    checkGates(dt);
    state.flightTime += dt;
  } else if (state.phase === 'celebrating') {
    bird.update(dt, { turn: 0, pitch: 0.05, flap: false, boost: false });
    checkHazards(dt);
    state.celebration -= dt;
    if (state.celebration <= 0) showComplete();
  } else if (state.phase === 'paused') {
    // keep the valley breathing, freeze the bird
  } else if (state.phase === 'complete') {
    bird.idle(dt);
  }

  if (state.phase !== 'menu') {
    updateHud();
  }

  if (bird.didFlap && state.phase === 'playing') {
    sound.flap();
  }
  sound.setSpeed(bird.speed);

  world.update(dt, shaderTime, bird.position, state.phase === 'playing');
  effects.update(dt);

  updateCamera(dt, shaderTime);

  gradePass.material.uniforms.uTime.value = shaderTime;
  renderer.info.reset();
  composer.render();

  frameCount++;
  if (frameCount === 4) {
    ui.loading.classList.add('done');
    setTimeout(() => { ui.loading.style.display = 'none'; }, 1300);
    if (params.get('autostart') === '1' && !autoStarted) {
      autoStarted = true;
      setTimeout(() => startGame(false), 400);
    }
  }
}

renderer.setAnimationLoop(animate);

// expose a small handle for debugging / automated captures
window.__KAZE = {
  get phase() { return state.phase; },
  bird,
  world,
  camera,
  startGame,
  state,
  restartGame,
};

// initial camera frame
updateCamera(0.016, 0);
