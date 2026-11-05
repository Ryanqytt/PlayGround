import * as THREE from 'three';

export class Effects {
  constructor(scene, texture) {
    this.scene = scene;
    this.texture = texture;
    this.bursts = [];
  }

  burst(position, color = 0xffe4a6, count = 46, spread = 15, size = 1.6) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.35,
        Math.random() - 0.5,
      ).normalize().multiplyScalar((0.35 + Math.random() * 0.65) * spread);
      velocities.push(dir);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: this.texture,
      color,
      size,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    const flashMat = new THREE.SpriteMaterial({
      map: this.texture,
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.position.copy(position);
    flash.scale.setScalar(12);
    this.scene.add(flash);

    this.bursts.push({
      points,
      velocities,
      flash,
      age: 0,
      life: 1.7,
      count,
    });
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      const arr = b.points.geometry.attributes.position.array;
      for (let p = 0; p < b.count; p++) {
        const v = b.velocities[p];
        arr[p * 3] += v.x * dt;
        arr[p * 3 + 1] += v.y * dt;
        arr[p * 3 + 2] += v.z * dt;
        v.multiplyScalar(1 - dt * 1.6);
        v.y += dt * 0.7;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - t * t);
      b.points.material.size = 1.6 * (1 + t * 1.3);
      b.flash.scale.setScalar(12 + t * 34);
      b.flash.material.opacity = Math.max(0, 0.9 * (1 - t * 2.2));
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        this.scene.remove(b.flash);
        b.points.geometry.dispose();
        b.points.material.dispose();
        b.flash.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
