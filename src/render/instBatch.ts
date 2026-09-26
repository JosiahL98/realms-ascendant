import * as THREE from 'three';

/** Growable InstancedMesh wrapper with optional per-instance color and construction clip. */
export class InstBatch {
  mesh: THREE.InstancedMesh;
  capacity: number;
  count = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;
  private hasColor: boolean;
  private hasClip: boolean;
  private parent: THREE.Object3D;
  private shadow: boolean;
  private receive: boolean;
  private clipArr: Float32Array | null = null;
  private tmpC = new THREE.Color();

  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
    opts: { color?: boolean; clip?: boolean; cap?: number; shadow?: boolean; receive?: boolean } = {}) {
    this.parent = parent;
    this.geo = geo;
    this.mat = mat;
    this.hasColor = !!opts.color;
    this.hasClip = !!opts.clip;
    this.shadow = opts.shadow ?? true;
    this.receive = opts.receive ?? true;
    this.capacity = 0;
    this.mesh = this.create(opts.cap ?? 16, null);
  }

  private create(cap: number, old: THREE.InstancedMesh | null): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.frustumCulled = false;
    m.castShadow = this.shadow;
    m.receiveShadow = this.receive;
    m.count = 0;
    if (this.hasColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    if (this.hasClip) {
      const arr = new Float32Array(cap).fill(1000);
      if (this.clipArr) arr.set(this.clipArr.subarray(0, Math.min(this.clipArr.length, cap)));
      this.clipArr = arr;
      this.geo.setAttribute('instClip', new THREE.InstancedBufferAttribute(arr, 1));
    }
    if (old) {
      (m.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, Math.min(old.instanceMatrix.array.length, cap * 16)));
      if (old.instanceColor && m.instanceColor) (m.instanceColor.array as Float32Array).set((old.instanceColor.array as Float32Array).subarray(0, cap * 3));
      this.parent.remove(old);
      old.dispose();
    }
    this.parent.add(m);
    this.capacity = cap;
    return m;
  }

  begin(): void {
    this.count = 0;
  }

  add(matrix: THREE.Matrix4, color?: number, clip?: number): void {
    if (this.count >= this.capacity) this.mesh = this.create(this.capacity * 2, this.mesh);
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    if (this.hasColor) this.mesh.setColorAt(i, this.tmpC.setHex(color ?? 0xffffff));
    if (this.hasClip && this.clipArr) this.clipArr[i] = clip ?? 1000;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.hasClip) {
      const a = this.geo.getAttribute('instClip') as THREE.InstancedBufferAttribute;
      a.needsUpdate = true;
    }
  }
}
