import * as THREE from 'three';
import type { GameMap } from '../sim/map';
import { worldUniforms } from './materials';
import { makeNoiseTexture, makeTerrainTextures } from './textures';

export class TerrainView {
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  private typeTex: THREE.DataTexture;
  private heightTex: THREE.DataTexture;
  readonly noiseTex: THREE.DataTexture;
  readonly terrainTex: THREE.DataArrayTexture;
  private waterMat: THREE.ShaderMaterial;

  constructor(map: GameMap, photo: THREE.DataArrayTexture | null = null) {
    const n = map.n;
    this.terrainTex = photo ?? makeTerrainTextures(7);
    this.noiseTex = makeNoiseTexture(5);

    // tile type map
    const types = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) types[i * 4] = map.terrain[i];
    this.typeTex = new THREE.DataTexture(types, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.typeTex.magFilter = this.typeTex.minFilter = THREE.NearestFilter;
    this.typeTex.needsUpdate = true;

    // height texture for water depth
    const W = n + 1;
    const hdata = new Uint16Array(W * W);
    for (let i = 0; i < W * W; i++) hdata[i] = THREE.DataUtils.toHalfFloat(map.heights[i]);
    this.heightTex = new THREE.DataTexture(hdata, W, W, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    // Terrain geometry
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(W * W * 3);
    for (let z = 0; z <= n; z++)
      for (let x = 0; x <= n; x++) {
        const i = z * W + x;
        pos[i * 3] = x;
        pos[i * 3 + 1] = map.heights[i];
        pos[i * 3 + 2] = z;
      }
    const idx: number[] = [];
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const a = z * W + x, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const cols = new Float32Array(W * W * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const typeTex = this.typeTex, terrainTex = this.terrainTex, noiseTex = this.noiseTex;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTypeMap = { value: typeTex };
      shader.uniforms.uTerrainTex = { value: terrainTex };
      shader.uniforms.uNoiseTex = { value: noiseTex };
      shader.uniforms.uFogTex = worldUniforms.uFogTex;
      shader.uniforms.uMapSize = worldUniforms.uMapSize;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;`)
        .replace('#include <project_vertex>', `#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uTypeMap;
          uniform highp sampler2DArray uTerrainTex;
          uniform sampler2D uNoiseTex;
          uniform sampler2D uFogTex;
          uniform float uMapSize;
          varying vec3 vWPos;
          varying vec3 vWNorm;
          float tileType(vec2 t) {
            ivec2 it = clamp(ivec2(t), ivec2(0), ivec2(int(uMapSize) - 1));
            return floor(texelFetch(uTypeMap, it, 0).r * 255.0 + 0.5);
          }
        `)
        .replace('#include <map_fragment>', `
          {
            vec2 p = vWPos.xz;
            vec2 nz = (texture2D(uNoiseTex, p * 0.083).gb - 0.5) * 1.1 + (texture2D(uNoiseTex, p * 0.31).gb - 0.5) * 0.35;
            vec2 q = p - 0.5 + nz;
            vec2 i = floor(q);
            vec2 f = fract(q);
            float t00 = tileType(i);
            float t10 = tileType(i + vec2(1.0, 0.0));
            float t01 = tileType(i + vec2(0.0, 1.0));
            float t11 = tileType(i + vec2(1.0, 1.0));
            // two scales (the second rotated) hide the tiling of the photo textures
            vec2 uvA = p * 0.25;
            vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * (p * 0.09) + vec2(0.37, 0.61);
            vec4 c00 = mix(texture(uTerrainTex, vec3(uvA, t00)), texture(uTerrainTex, vec3(uvB, t00)), 0.42);
            vec4 c10 = mix(texture(uTerrainTex, vec3(uvA, t10)), texture(uTerrainTex, vec3(uvB, t10)), 0.42);
            vec4 c01 = mix(texture(uTerrainTex, vec3(uvA, t01)), texture(uTerrainTex, vec3(uvB, t01)), 0.42);
            vec4 c11 = mix(texture(uTerrainTex, vec3(uvA, t11)), texture(uTerrainTex, vec3(uvB, t11)), 0.42);
            vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
            vec4 hg = (vec4(c00.a, c10.a, c01.a, c11.a) - 0.5) * 2.0;
            w = w * (0.35 + hg);
            w = w * w * w * w;
            w /= max(dot(w, vec4(1.0)), 1e-5);
            vec3 col = c00.rgb * w.x + c10.rgb * w.y + c01.rgb * w.z + c11.rgb * w.w;
            float m = texture2D(uNoiseTex, p * 0.012).r;
            float m2 = texture2D(uNoiseTex, p * 0.045 + 0.3).g;
            col *= 0.9 + m * 0.18 + (m2 - 0.5) * 0.1;
            float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
            vec3 rock = texture(uTerrainTex, vec3(p * 0.18, 10.0)).rgb * (0.85 + m2 * 0.3);
            col = mix(col, rock, smoothstep(0.26, 0.48, slope) * 0.85);
            // wet sand near the waterline
            col *= mix(0.7, 1.0, smoothstep(-0.35, -0.05, vWPos.y));
            diffuseColor.rgb = col;
          }
        `)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          {
            float fw = texture2D(uFogTex, vWPos.xz / uMapSize).r;
            float k = fw < 0.5 ? fw * 0.62 : mix(0.31, 1.0, (fw - 0.5) * 2.0);
            float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
            gl_FragColor.rgb = mix(mix(vec3(lum), gl_FragColor.rgb, 0.45), gl_FragColor.rgb, smoothstep(0.5, 1.0, fw)) * k;
          }
        `);
    };
    mat.customProgramCacheKey = () => 'terrain';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    // Water
    const wgeo = new THREE.PlaneGeometry(n, n, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    wgeo.translate(n / 2, map.waterLevel, n / 2);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uHeight: { value: this.heightTex },
        uNoise: { value: this.noiseTex },
        uFogTex: worldUniforms.uFogTex,
        uMapSize: worldUniforms.uMapSize,
        uTime: worldUniforms.uTime,
        uWaterLevel: { value: map.waterLevel },
        uSunDir: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() },
      },
      vertexShader: `
        varying vec3 vWPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform sampler2D uHeight;
        uniform sampler2D uNoise;
        uniform sampler2D uFogTex;
        uniform float uMapSize;
        uniform float uTime;
        uniform float uWaterLevel;
        uniform vec3 uSunDir;
        varying vec3 vWPos;
        void main() {
          vec2 p = vWPos.xz;
          float h = texture2D(uHeight, (p + 0.5) / (uMapSize + 1.0)).r;
          float depth = uWaterLevel - h;
          if (depth < -0.01) discard;
          // gently scrolling swells tint the colour
          vec2 a = p * 0.045 + vec2(uTime * 0.010, uTime * 0.006);
          float n1 = texture2D(uNoise, a).g;
          float n2 = texture2D(uNoise, p * 0.11 - vec2(uTime * 0.013, -uTime * 0.009)).b;
          // large slow swells: normals from the low-frequency noise channel
          const float e = 1.0 / 128.0;
          vec2 ra = p * 0.05 + vec2(uTime * 0.008, uTime * 0.005);
          float ha = texture2D(uNoise, ra).r;
          vec2 grad = vec2(texture2D(uNoise, ra + vec2(e, 0.0)).r - ha, texture2D(uNoise, ra + vec2(0.0, e)).r - ha);
          float calm = mix(0.3, 1.0, smoothstep(0.0, 0.8, depth));
          vec3 nrm = normalize(vec3(-grad.x * 14.0 * calm, 1.0, -grad.y * 14.0 * calm));
          vec3 viewDir = normalize(vec3(0.61, 0.5, 0.61));
          vec3 shallow = vec3(0.08, 0.32, 0.42);
          vec3 deep = vec3(0.04, 0.14, 0.3);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 1.8, depth));
          col *= 0.9 + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.16;
          // sunlight dappling the shallows
          vec2 ca = p * 0.42 + vec2(uTime * 0.045, uTime * 0.03);
          vec2 cb = mat2(0.6, 0.8, -0.8, 0.6) * p * 0.42 - vec2(uTime * 0.035, -uTime * 0.04);
          float caust = pow(1.0 - abs(texture2D(uNoise, ca).g - texture2D(uNoise, cb).g) * 2.2, 7.0);
          col += vec3(0.42, 0.52, 0.46) * caust * smoothstep(0.9, 0.05, depth) * 0.35;
          // sky reflection on swells tilted away from the viewer
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(nrm, viewDir), 0.0), 5.0);
          col = mix(col, vec3(0.42, 0.56, 0.7), clamp(fres * 1.3, 0.0, 0.3));
          // soft wave crests drifting across open water, warped by the swell noise
          float w1 = sin(dot(p, vec2(0.8, 0.6)) * 3.0 - uTime * 0.8 + n1 * 10.0 + n2 * 5.0);
          float w2 = sin(dot(p, vec2(-0.45, 0.9)) * 2.3 - uTime * 0.6 + n2 * 9.0 - n1 * 4.0);
          float crest = smoothstep(0.82, 1.0, w1) * 0.7 + smoothstep(0.86, 1.0, w2) * 0.5;
          col += vec3(0.08, 0.11, 0.12) * crest * calm;
          vec3 hv = normalize(uSunDir + viewDir);
          col += vec3(1.0, 0.95, 0.82) * pow(max(dot(nrm, hv), 0.0), 40.0) * 0.25;
          // wind-blown whitecaps out at sea
          float cap = smoothstep(0.74, 0.86, n1 * 0.55 + ha * 0.45) * smoothstep(0.6, 1.4, depth) * smoothstep(0.6, 1.0, w1);
          col = mix(col, vec3(0.8, 0.86, 0.88), cap * 0.3);
          // shore foam bands
          float band = sin(depth * 40.0 - uTime * 1.5 + n1 * 6.0) * 0.5 + 0.5;
          float foam = smoothstep(0.1, 0.0, depth) * (0.35 + 0.4 * band);
          col = mix(col, vec3(0.72, 0.78, 0.76), foam * 0.6);
          float alpha = mix(0.56, 0.94, smoothstep(0.0, 0.6, depth));
          alpha = max(alpha, foam * 0.7);
          float fw = texture2D(uFogTex, p / uMapSize).r;
          float k = fw < 0.5 ? fw * 0.62 : mix(0.31, 1.0, (fw - 0.5) * 2.0);
          col *= k;
          alpha = mix(alpha, 1.0, 1.0 - smoothstep(0.0, 0.3, fw));
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.water = new THREE.Mesh(wgeo, this.waterMat);
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
  }
}
