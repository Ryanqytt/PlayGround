import * as THREE from 'three';
import { clamp, damp, smoothstep } from './utils.js';
import { makeToonGradient } from './textures.js';

function makeFeatherGeometry(length, width, variant = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.05);
  shape.bezierCurveTo(length * 0.22, width * 1.0, length * 0.68, width * 0.84, length, 0.03);
  shape.bezierCurveTo(length * 0.74, -width * 0.56, length * 0.3, -width * 0.9, 0, -0.03);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 10);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const bases = [0xfdfaf1, 0xcdd0c7, 0x979e99];
  const tips = [0xb8bcb4, 0x6c7470, 0x202625];
  const base = new THREE.Color(bases[variant] ?? bases[0]);
  const tip = new THREE.Color(tips[variant] ?? tips[0]);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getX(i) / length, 0, 1);
    const start = variant === 2 ? 0.12 : 0.5;
    c.copy(base).lerp(tip, smoothstep(start, 1.0, t) * (variant === 2 ? 0.9 : 0.6));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class Bird {
  constructor(scene) {
    this.scene = scene;
    this.position = new THREE.Vector3();
    this.velocityForward = new THREE.Vector3(0, 0, -1);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 32;
    this.wind = 1;
    this.flapTimer = 0;
    this.flapCooldown = 0;
    this.flapPhase = 0;
    this.verticalKick = 0;
    this.bankInput = 0;
    this.pitchInput = 0;
    this.crashCooldown = 0;
    this.lastSafe = new THREE.Vector3();

    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.group.add(this.model);
    this.scene.add(this.group);

    this._buildModel();

    this.forward = new THREE.Vector3(0, 0, -1);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.smoothHead = 0;
  }

  _buildModel() {
    const wingGradient = makeToonGradient([96, 152, 206, 255]);
    const white = new THREE.MeshStandardMaterial({
      color: 0xf6f1e3,
      roughness: 0.68,
      metalness: 0.0,
    });
    const cream = new THREE.MeshStandardMaterial({
      color: 0xefe7d3,
      roughness: 0.75,
      metalness: 0.0,
    });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xe0a053, roughness: 0.55, metalness: 0.05 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b211f });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const legMat = new THREE.MeshStandardMaterial({ color: 0xca8f4e, roughness: 0.7 });

    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = 0;
    this.bodyGroup = bodyGroup;
    this.model.add(bodyGroup);

    // body
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), white);
    body.scale.set(0.62, 0.66, 1.55);
    body.castShadow = true;
    body.receiveShadow = true;
    bodyGroup.add(body);

    // breast
    const breast = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), cream);
    breast.scale.set(0.8, 0.86, 1.0);
    breast.position.set(0, -0.16, -0.45);
    breast.castShadow = true;
    bodyGroup.add(breast);

    // neck + head
    const head = new THREE.Group();
    head.position.set(0, 0.22, -1.16);
    this.head = head;
    bodyGroup.add(head);

    const neck = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), cream);
    neck.scale.set(0.82, 1.15, 1.25);
    neck.position.set(0, 0.05, 0.16);
    neck.castShadow = true;
    head.add(neck);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), white);
    skull.scale.set(0.9, 0.94, 1.05);
    skull.position.set(0, 0.36, -0.18);
    skull.castShadow = true;
    head.add(skull);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.72, 7), beakMat);
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, 0.28, -0.72);
    beak.castShadow = true;
    head.add(beak);
    const beakLower = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 6), beakMat);
    beakLower.rotation.x = -Math.PI / 2;
    beakLower.position.set(0, 0.17, -0.6);
    head.add(beakLower);

    // eyes
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), eyeMat);
      eye.position.set(side * 0.255, 0.46, -0.4);
      head.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), glintMat);
      glint.position.set(side * 0.278, 0.492, -0.44);
      head.add(glint);
    }

    // tail fan
    const tail = new THREE.Group();
    tail.position.set(0, 0.12, 1.42);
    this.tail = tail;
    bodyGroup.add(tail);
    const tailMats = [
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: wingGradient, side: THREE.DoubleSide }),
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: wingGradient, side: THREE.DoubleSide }),
    ];
    for (let i = -2; i <= 2; i++) {
      const f = new THREE.Mesh(makeFeatherGeometry(1.15 - Math.abs(i) * 0.1, 0.3, i === 0 ? 0 : 1), tailMats[Math.abs(i) % 2]);
      f.position.set(i * 0.14, 0, 0);
      f.rotation.y = -Math.PI / 2 + i * 0.17;
      f.rotation.x = 0.12;
      f.castShadow = true;
      tail.add(f);
    }

    // tucked feet
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.7, 5), legMat);
      leg.position.set(side * 0.22, -0.55, 0.55);
      leg.rotation.x = 0.9;
      bodyGroup.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.32), legMat);
      foot.position.set(side * 0.22, -0.74, 0.75);
      bodyGroup.add(foot);
    }

    // wings
    const featherMats = [
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: wingGradient, side: THREE.DoubleSide }),
    ];
    const makeWing = () => {
      const wing = new THREE.Group();
      // tilt the whole airfoil so the upper surface catches the chase camera
      const panel = new THREE.Group();
      panel.rotation.x = 0.32;
      wing.add(panel);
      // broad arm membrane from shoulder to wrist, with a rounded trailing edge
      const planform = new THREE.Shape();
      planform.moveTo(0.04, 0.62);
      planform.bezierCurveTo(0.9, 0.58, 1.8, 0.4, 2.5, 0.14);
      planform.bezierCurveTo(2.36, -0.34, 2.05, -0.78, 1.55, -1.06);
      planform.bezierCurveTo(1.02, -1.32, 0.44, -1.4, 0.06, -1.24);
      planform.closePath();
      const membraneGeo = new THREE.ShapeGeometry(planform, 18);
      membraneGeo.rotateX(-Math.PI / 2);
      const membrane = new THREE.Mesh(membraneGeo, new THREE.MeshToonMaterial({
        color: 0xe6e2d5,
        gradientMap: wingGradient,
        side: THREE.DoubleSide,
      }));
      membrane.position.y = -0.045;
      membrane.castShadow = true;
      panel.add(membrane);

      // shoulder covert
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), white);
      shoulder.scale.set(1.5, 0.42, 1.35);
      shoulder.position.set(0.28, 0.04, 0.1);
      shoulder.castShadow = true;
      panel.add(shoulder);

      const feathers = [];
      let phase = 0;

      // secondaries: a soft feathered fan along the trailing edge
      const secondaryCount = 6;
      for (let i = 0; i < secondaryCount; i++) {
        const t = i / (secondaryCount - 1);
        const length = 1.25 + t * 0.55;
        const geo = makeFeatherGeometry(length, 0.34 + (1 - t) * 0.1, t > 0.72 ? 1 : 0);
        const f = new THREE.Mesh(geo, featherMats[0]);
        f.position.set(0.16 + t * 1.55, 0.03 + i * 0.008, -0.62 + t * 0.2);
        f.rotation.y = -1.12 + t * 0.14;
        f.rotation.z = -0.02;
        f.castShadow = true;
        panel.add(f);
        feathers.push({ mesh: f, baseY: f.rotation.y, phase: phase });
        phase += 0.38;
      }

      // primaries: long fingers fanning out and sweeping back from the wrist
      const primaryCount = 5;
      for (let i = 0; i < primaryCount; i++) {
        const t = i / (primaryCount - 1);
        const length = 2.1 + (1 - t) * 0.85;
        const variant = i >= primaryCount - 2 ? 2 : (i === primaryCount - 3 ? 1 : 0);
        const geo = makeFeatherGeometry(length, 0.52 + (1 - t) * 0.14, variant);
        const f = new THREE.Mesh(geo, featherMats[0]);
        f.position.set(1.58 + t * 0.55, 0.055 + i * 0.008, 0.12 + t * 0.22);
        f.rotation.y = -0.08 - t * 0.34;
        f.rotation.z = -0.015;
        f.castShadow = true;
        panel.add(f);
        feathers.push({ mesh: f, baseY: f.rotation.y, phase: phase });
        phase += 0.42;
      }

      // a soft underwing layer
      const under = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), cream);
      under.scale.set(1.5, 0.14, 0.7);
      under.position.set(0.8, -0.1, 0.1);
      under.castShadow = true;
      panel.add(under);

      wing.userData.feathers = feathers;
      return wing;
    };

    this.wingR = makeWing();
    this.wingR.position.set(0.3, 0.2, -0.12);
    bodyGroup.add(this.wingR);

    // mirror the whole animated wing so flapping and sweep stay symmetrical
    this.wingLMirror = new THREE.Group();
    this.wingLMirror.scale.x = -1;
    this.wingL = makeWing();
    this.wingL.position.set(0.3, 0.2, -0.12);
    this.wingLMirror.add(this.wingL);
    bodyGroup.add(this.wingLMirror);

    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
  }

  reset(x, y, z, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.baseYaw = yaw;
    this.pitch = -0.03;
    this.roll = 0;
    this.speed = 32;
    this.wind = 1;
    this.flapTimer = 0;
    this.flapPhase = 0;
    this.verticalKick = 0;
    this.crashCooldown = 0;
    this.lastSafe.copy(this.position);
    this.group.position.copy(this.position);
  }

  getForward(target = this.forward) {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    return target.set(0, 0, -1).applyEuler(this.euler).normalize();
  }

  idle(dt) {
    this.time = (this.time || 0) + dt;
    this.flapPhase += dt * Math.PI * 2 * 0.24;
    const wingAngle = 0.31 + Math.sin(this.flapPhase) * 0.06;
    this.wingR.rotation.z = wingAngle;
    this.wingL.rotation.z = wingAngle;
    this.wingR.rotation.y = -0.03;
    this.wingL.rotation.y = -0.03;
    this.wingR.rotation.x = 0;
    this.wingL.rotation.x = 0;
    const foldAngle = 0.03;
    for (const side of [this.wingR, this.wingL]) {
      for (const f of side.userData.feathers) {
        f.mesh.rotation.y = f.baseY + Math.sin(this.flapPhase + f.phase) * 0.008 - foldAngle * 0.12;
        f.mesh.rotation.z = -0.015 + Math.cos(this.flapPhase + f.phase) * 0.006;
      }
    }
    this.bodyGroup.position.y = Math.sin(this.flapPhase * 0.5) * 0.03;
    this.bodyGroup.rotation.z = 0;
    this.bodyGroup.rotation.x = Math.sin(this.time * 0.7) * 0.012;
    this.head.rotation.y = Math.sin(this.time * 0.19) * 0.24;
    this.head.rotation.x = Math.sin(this.time * 0.31) * 0.035;
    this.tail.rotation.y = Math.sin(this.time * 0.23) * 0.05;
    this.tail.rotation.x = Math.sin(this.time * 0.9) * 0.02;

    this.yaw = this.baseYaw + Math.sin(this.time * 0.08) * 0.035;
    this.group.position.copy(this.position);
    this.euler.set(this.pitch, this.yaw, this.roll + 0.085 + Math.sin(this.time * 0.16) * 0.025, 'YXZ');
    this.group.quaternion.setFromEuler(this.euler);
  }

  update(dt, input) {
    this.time = (this.time || 0) + dt;
    this.didFlap = false;

    const turn = clamp(input.turn || 0, -1, 1);
    const pitchIn = clamp(input.pitch || 0, -1, 1);
    const boost = !!input.boost;
    const wantFlap = !!input.flap;

    this.bankInput = damp(this.bankInput, turn, 5.5, dt);
    this.pitchInput = damp(this.pitchInput, pitchIn, 4.0, dt);

    // banked turn
    const rollTarget = -this.bankInput * 0.82;
    this.roll = damp(this.roll, rollTarget, 3.6, dt);
    const turnRate = (0.42 + this.speed * 0.011) * (0.65 + 0.35 * Math.cos(this.pitch));
    this.yaw -= this.bankInput * turnRate * dt * 1.25;

    // pitch — a little nose-down trim, and a stronger tuck while boosting
    const pitchTarget = this.pitchInput * 0.66 - 0.055 + (boost ? -0.22 : 0);
    this.pitch = damp(this.pitch, pitchTarget, 2.8, dt);
    this.pitch = clamp(this.pitch, -1.0, 0.92);

    // energy: diving trades height for speed, climbing trades speed for height
    let targetSpeed = 31 + -this.pitch * 27 + (boost ? 15 : 0);
    targetSpeed = clamp(targetSpeed, 13, 74);
    this.speed = damp(this.speed, targetSpeed, 0.95, dt);

    this.flapCooldown = Math.max(0, this.flapCooldown - dt);
    if (wantFlap && this.flapCooldown <= 0 && this.wind > 0.06) {
      this.speed = Math.min(80, this.speed + 8.5);
      this.wind = Math.max(0, this.wind - 0.145);
      this.flapTimer = 0.86;
      this.flapCooldown = 0.32;
      this.verticalKick = Math.min(9, this.verticalKick + 6.2);
      this.didFlap = true;
    }
    this.verticalKick = damp(this.verticalKick, 0, 2.4, dt);

    // wind recovers while gliding; faster while diving
    const recovery = this.pitch < -0.25 ? 0.13 : 0.048;
    if (this.flapTimer <= 0) this.wind = Math.min(1, this.wind + recovery * dt);

    this.getForward(this.velocityForward);
    this.position.addScaledVector(this.velocityForward, this.speed * dt);
    this.position.y += this.verticalKick * dt;

    // a barely-there drift, so the bird feels alive
    const drift = Math.sin(this.time * 0.9) * 0.0015;
    this.roll += drift;

    // pose
    this.group.position.copy(this.position);
    this.euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(this.euler);

    this.flapTimer = Math.max(0, this.flapTimer - dt);
    const flapping = this.flapTimer > 0;
    const flapSpeed = flapping ? Math.PI * 2 * 2.6 : Math.PI * 2 * 0.37;
    this.flapPhase += dt * flapSpeed;

    const amp = flapping ? 0.72 : 0.075;
    const base = 0.23;
    const wingAngle = base + Math.sin(this.flapPhase) * amp;
    const fold = smoothstep(43, 64, this.speed) * 0.5 + (boost ? 0.28 : 0) + clamp((this.speed - 70) / 20, 0, 0.22);
    const foldAngle = clamp(fold, 0, 0.88);

    this.wingR.rotation.z = wingAngle;
    this.wingL.rotation.z = wingAngle;
    this.wingR.rotation.y = -foldAngle;
    this.wingL.rotation.y = -foldAngle;
    this.wingR.rotation.x = Math.sin(this.flapPhase * 0.5) * 0.02;
    this.wingL.rotation.x = this.wingR.rotation.x;

    for (const side of [this.wingR, this.wingL]) {
      const f = side.userData.feathers;
      for (let i = 0; i < f.length; i++) {
        const feather = f[i];
        feather.mesh.rotation.y = feather.baseY + Math.sin(this.flapPhase + feather.phase) * 0.025 * (flapping ? 1 : 0.3) - foldAngle * 0.12;
        feather.mesh.rotation.z = -0.015 + Math.cos(this.flapPhase * 0.8 + feather.phase) * 0.008;
      }
    }

    const bob = Math.sin(this.flapPhase * 0.5) * (flapping ? 0.055 : 0.018);
    this.bodyGroup.position.y = bob;
    this.bodyGroup.rotation.z = -this.bankInput * 0.06;
    this.bodyGroup.rotation.x = Math.sin(this.time * 0.7) * 0.012;

    this.head.rotation.y = damp(this.head.rotation.y, -this.bankInput * 0.22, 3, dt) - this.bankInput * 0.06;
    this.head.rotation.x = damp(this.head.rotation.x, -this.pitch * 0.15, 3, dt);
    this.tail.rotation.y = damp(this.tail.rotation.y, this.bankInput * 0.24, 3, dt);
    this.tail.rotation.x = -this.pitch * 0.12 + Math.sin(this.time * 1.3) * 0.015;

    // remember a safe spot in case a cliff sneaks up
    const ground = this.world ? this.world.heightAt(this.position.x, this.position.z) : 0;
    if (this.position.y > ground + 34) {
      this.safeTimer = (this.safeTimer || 0) + dt;
      if (this.safeTimer > 0.7) {
        this.lastSafe.copy(this.position);
        this.safeTimer = 0;
      }
    } else {
      this.safeTimer = 0;
    }
  }

  respawn(world) {
    const safe = this.lastSafe;
    this.position.copy(safe);
    const ground = world.heightAt(safe.x, safe.z);
    this.position.y = Math.max(this.position.y, ground + 55, 70);
    this.speed = 34;
    this.pitch = 0;
    this.roll = 0;
    this.verticalKick = 0;
    this.flapTimer = 0.5;
    this.flapPhase = 0;
    this.wind = Math.min(1, this.wind + 0.25);
    this.group.position.copy(this.position);
  }

  faceTo(target, instant = false) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const yaw = Math.atan2(-dx, -dz);
    if (instant) this.yaw = yaw;
    else {
      let diff = yaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * 0.01;
    }
  }
}
