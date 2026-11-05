import * as THREE from 'three';
import { mulberry32 } from './utils.js';

export function makeToonGradient(steps = [72, 142, 208, 255]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeGlowTexture(size = 128, inner = 'rgba(255,248,220,1)', outer = 'rgba(255,214,140,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.18, inner);
  g.addColorStop(0.45, 'rgba(255,226,160,0.32)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeDotTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makePetalTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-0.5);
  const g = ctx.createLinearGradient(-size * 0.3, 0, size * 0.3, 0);
  g.addColorStop(0, 'rgba(255,238,242,1)');
  g.addColorStop(0.6, 'rgba(255,196,210,1)');
  g.addColorStop(1, 'rgba(246,166,188,0.9)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.28, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGrassTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dde0c9';
  ctx.fillRect(0, 0, size, size);
  const rng = mulberry32(99173);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const h = 1 + rng() * 5;
    const shade = 170 + Math.floor(rng() * 70);
    const tint = rng() < 0.2 ? 235 : shade;
    ctx.strokeStyle = `rgba(${tint - 14},${tint},${tint - 40},${0.16 + rng() * 0.22})`;
    ctx.lineWidth = 0.7 + rng() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - h);
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 8 + rng() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const bright = rng() < 0.5;
    g.addColorStop(0, bright ? 'rgba(240,238,196,0.10)' : 'rgba(120,140,88,0.10)');
    g.addColorStop(1, 'rgba(200,200,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeCloudTexture() {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rng = mulberry32(417);
  for (let i = 0; i < 26; i++) {
    const x = w * (0.18 + rng() * 0.64);
    const y = h * (0.38 + rng() * 0.34);
    const r = 20 + rng() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,238,0.30)');
    g.addColorStop(0.55, 'rgba(246,243,232,0.15)');
    g.addColorStop(1, 'rgba(240,240,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
