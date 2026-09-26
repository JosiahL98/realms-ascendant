import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** low: no shadows; medium: shadows; high: shadows plus screen-space ambient occlusion (needs a strong GPU). */
export type GraphicsQuality = 'low' | 'medium' | 'high';

/**
 * Colour grade folded into the tone-mapping step so it costs no extra pass: a little saturation and contrast in
 * linear space, a touch of warmth and lifted blacks, then three's neutral tone curve.
 */
const GRADED_TONE_MAPPING = `
vec3 CustomToneMapping( vec3 color ) {
  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = mix( vec3( l ), color, 1.03 );
  color = max( vec3( 0.0 ), ( color - 0.18 ) * 1.06 + 0.18 );
  color *= vec3( 1.012, 1.0036, 0.988 );
  color += 0.006 * vec3( 0.8, 0.9, 1.0 );
  return NeutralToneMapping( color );
}`;

let gradeInstalled = false;

/** Must run before any material compiles. */
export function installGrading(): void {
  if (gradeInstalled) return;
  gradeInstalled = true;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(stub)) console.warn('tone mapping chunk changed; colour grade not installed');
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, GRADED_TONE_MAPPING);
}

/** GTAO that also leaves out objects tagged userData.noAO (alpha-tested foliage) when rendering its normal/depth pass. */
class FoliageAwareGTAOPass extends GTAOPass {
  private hidden: THREE.Object3D[] = [];

  _overrideVisibility(): void {
    const hidden = this.hidden;
    this.scene.traverse((o) => {
      const skip = (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as { isLine2?: boolean }).isLine2 || o.userData.noAO;
      if (skip && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
  }

  _restoreVisibility(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
}

/**
 * High-quality path: scene into a multisampled half-float target, ambient occlusion, then tone mapping
 * (with the grade) and sRGB output. Lower qualities render straight to the canvas instead.
 */
export class PostFX {
  composer: EffectComposer;
  private gtao: FoliageAwareGTAOPass;
  private gl: THREE.WebGLRenderer;

  constructor(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.gl = gl;
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(gl, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new FoliageAwareGTAOPass(scene, camera, size.x, size.y);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 16, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(w, h);
    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.gtao.setSize(size.x, size.y);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.gtao.dispose();
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
