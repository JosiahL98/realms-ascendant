import * as THREE from 'three';
import { foliageAtlas } from './models/foliage';

/** Uniforms shared by every world material (fog of war, time, detail textures). */
export const worldUniforms = {
  uFogTex: { value: null as THREE.Texture | null },
  uMapSize: { value: 120 },
  uTime: { value: 0 },
  uDetailTex: { value: null as THREE.Texture | null },
  /** Multiplier that makes the detail texture average out to 1. */
  uDetailGain: { value: 1.9 },
};

export interface WorldMatOpts {
  /** Where to sample the fog-of-war: per fragment, at the object origin, or not at all. */
  fog?: 'origin' | 'fragment' | 'none';
  /** Per-instance 'instClip' attribute clips geometry above that local height (construction). */
  clip?: boolean;
  /** Triplanar detail texture by per-vertex 'matId'. */
  detail?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  flat?: boolean;
  depthWrite?: boolean;
  /** Per-instance 'instFade' attribute: 0..1 opacity (corpses sinking etc.) */
  fade?: boolean;
  emissive?: number;
  /** Gentle wind sway for foliage (vertex colors with high green). */
  sway?: boolean;
  /** Alpha-tested leaf cards textured from the foliage atlas; lit by their canopy normals on both sides. */
  leaves?: boolean;
}

const materialCache = new Map<string, THREE.MeshLambertMaterial>();

export function makeWorldMaterial(opts: WorldMatOpts = {}): THREE.MeshLambertMaterial {
  const key = JSON.stringify(opts);
  const cached = materialCache.get(key);
  if (cached) return cached;
  const fog = opts.fog ?? 'origin';
  const m = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: !!opts.flat,
    transparent: !!opts.transparent || !!opts.fade,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  });
  if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
  if (opts.leaves) {
    m.map = foliageAtlas();
    m.alphaTest = 0.5;
    m.alphaToCoverage = true;
    m.side = THREE.DoubleSide;
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFogTex = worldUniforms.uFogTex;
    shader.uniforms.uMapSize = worldUniforms.uMapSize;
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uDetailTex = worldUniforms.uDetailTex;
    shader.uniforms.uDetailGain = worldUniforms.uDetailGain;
    let vDecl = `
      uniform float uMapSize;
      uniform float uTime;
      varying vec2 vFogXZ;
    `;
    let vBody = '';
    if (fog !== 'none') {
      vBody += fog === 'origin'
        ? `vec4 fogO = vec4(0.0, 0.0, 0.0, 1.0);`
        : `vec4 fogO = vec4(transformed, 1.0);`;
      vBody += `
        #ifdef USE_INSTANCING
          fogO = instanceMatrix * fogO;
        #endif
        fogO = modelMatrix * fogO;
        vFogXZ = fogO.xz;
      `;
    }
    if (opts.clip) {
      vDecl += `attribute float instClip; varying float vLocalY; varying float vClip;`;
      vBody += `vLocalY = transformed.y; vClip = instClip;`;
    }
    if (opts.fade) {
      vDecl += `attribute float instFade; varying float vFade;`;
      vBody += `vFade = instFade;`;
    }
    if (opts.detail) {
      vDecl += `attribute float matId; varying vec3 vObjPos; varying vec3 vObjNormal; varying float vMatId;`;
      vBody += `vObjPos = transformed; vObjNormal = objectNormal; vMatId = matId;`;
    }
    let swayCode = '';
    if (opts.sway) {
      swayCode = `
        {
          vec4 so = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            so = instanceMatrix * so;
          #endif
          float h = max(0.0, transformed.y - 0.6);
          float ph = so.x * 0.7 + so.z * 0.4;
          transformed.x += sin(uTime * 1.3 + ph) * 0.025 * h;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * 0.02 * h;
          ${opts.leaves ? `transformed += objectNormal * sin(uTime * 2.6 + dot(position, vec3(5.1, 3.7, 4.3)) + ph) * 0.018 * step(0.4, position.y);` : ''}
        }
      `;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vDecl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${swayCode}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${vBody}`);

    let fDecl = `
      uniform sampler2D uFogTex;
      uniform float uMapSize;
      varying vec2 vFogXZ;
    `;
    if (opts.clip) fDecl += `varying float vLocalY; varying float vClip;`;
    if (opts.fade) fDecl += `varying float vFade;`;
    if (opts.detail) {
      fDecl += `
        uniform highp sampler2DArray uDetailTex;
        uniform float uDetailGain;
        varying vec3 vObjPos; varying vec3 vObjNormal; varying float vMatId;
      `;
    }
    // leaf cards keep their outward canopy normal on the back face instead of flipping it
    const leafNormal = opts.leaves ? `normal = normalize(vNormal);` : '';
    let clipCode = '';
    if (opts.clip) clipCode = `if (vLocalY > vClip) discard;`;
    let detailCode = '';
    if (opts.detail) {
      detailCode = `
        {
          float mid = floor(vMatId + 0.5);
          if (mid > 0.5) {
            vec3 an = abs(normalize(vObjNormal));
            vec2 tuv;
            if (an.y > an.x && an.y > an.z) tuv = vObjPos.xz;
            else if (an.x > an.z) tuv = vec2(vObjPos.z, vObjPos.y);
            else tuv = vec2(vObjPos.x, vObjPos.y);
            vec3 d = texture(uDetailTex, vec3(tuv * 0.5, mid - 1.0)).rgb;
            diffuseColor.rgb *= d * uDetailGain;
          }
        }
      `;
    }
    let fogCode = '';
    if (fog !== 'none') {
      fogCode = `
        {
          float fw = texture2D(uFogTex, vFogXZ / uMapSize).r;
          float k = fw < 0.5 ? fw * 0.62 : mix(0.31, 1.0, (fw - 0.5) * 2.0);
          float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
          gl_FragColor.rgb = mix(mix(vec3(lum), gl_FragColor.rgb, 0.45), gl_FragColor.rgb, smoothstep(0.5, 1.0, fw)) * k;
        }
      `;
    }
    let fadeCode = '';
    if (opts.fade) fadeCode = `gl_FragColor.a *= vFade; if (gl_FragColor.a < 0.02) discard;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fDecl}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${clipCode}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${detailCode}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${leafNormal}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${fogCode}\n${fadeCode}`);
  };
  m.customProgramCacheKey = () => 'world:' + key;
  materialCache.set(key, m);
  return m;
}
