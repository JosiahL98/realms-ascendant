import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type GraphicsQuality = 'low' | 'medium' | 'high';

/** Colour grading in linear space: saturation, contrast, warmth and a soft vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.03 },
    uContrast: { value: 1.06 },
    uWarm: { value: 0.012 },
    uVignette: { value: 0.45 },
    uLift: { value: 0.006 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat, uContrast, uWarm, uVignette, uLift;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // contrast around a linear mid-grey keeps shadows rich without crushing them
      col = max(vec3(0.0), (col - 0.18) * uContrast + 0.18);
      col *= vec3(1.0 + uWarm, 1.0 + uWarm * 0.3, 1.0 - uWarm);
      col += uLift * vec3(0.8, 0.9, 1.0);
      vec2 d = (vUv - vec2(0.5, 0.55)) * vec2(1.0, 0.8);
      col *= 1.0 - dot(d, d) * uVignette;
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

/** Post-processing chain: scene -> ambient occlusion -> grading -> tone map/sRGB output. */
export class PostFX {
  composer: EffectComposer;
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass;
  quality: GraphicsQuality;
  private gl: THREE.WebGLRenderer;

  constructor(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: GraphicsQuality) {
    this.gl = gl;
    this.quality = quality;
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality === 'low' ? 0 : 4,
    });
    this.composer = new EffectComposer(gl, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality !== 'low') {
      const div = quality === 'high' ? 1 : 2;
      this.gtao = new GTAOPass(scene, camera, Math.max(1, size.x / div), Math.max(1, size.y / div));
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: quality === 'high' ? 16 : 10, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(w, h);
    if (this.gtao) {
      const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
      const div = this.quality === 'high' ? 1 : 2;
      this.gtao.setSize(Math.max(1, size.x / div), Math.max(1, size.y / div));
    }
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.gtao?.dispose();
    this.composer.dispose();
  }
}

export function loadQuality(): GraphicsQuality {
  try {
    const q = localStorage.getItem('ra-quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    /* ignore */
  }
  return 'medium';
}

export function saveQuality(q: GraphicsQuality): void {
  try {
    localStorage.setItem('ra-quality', q);
  } catch {
    /* ignore */
  }
}
