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

  constructor(map: GameMap) {
    const n = map.n;
    this.terrainTex = makeTerrainTextures(7);
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
            vec2 duv = p * 0.25;
            vec4 c00 = texture(uTerrainTex, vec3(duv, t00));
            vec4 c10 = texture(uTerrainTex, vec3(duv, t10));
            vec4 c01 = texture(uTerrainTex, vec3(duv, t01));
            vec4 c11 = texture(uTerrainTex, vec3(duv, t11));
            vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
            vec4 hg = vec4(c00.a, c10.a, c01.a, c11.a);
            w = w * (0.35 + hg);
            w = w * w * w * w;
            w /= max(dot(w, vec4(1.0)), 1e-5);
            vec3 col = c00.rgb * w.x + c10.rgb * w.y + c01.rgb * w.z + c11.rgb * w.w;
            float m = texture2D(uNoiseTex, p * 0.012).r;
            float m2 = texture2D(uNoiseTex, p * 0.045 + 0.3).g;
            col *= 0.84 + m * 0.26 + (m2 - 0.5) * 0.12;
            float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
            vec3 rock = vec3(0.34, 0.3, 0.25) * (0.8 + m2 * 0.4);
            col = mix(col, rock, smoothstep(0.28, 0.5, slope) * 0.8);
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
          // gently scrolling swells
          vec2 a = p * 0.045 + vec2(uTime * 0.010, uTime * 0.006);
          vec2 b = p * 0.11 - vec2(uTime * 0.013, -uTime * 0.009);
          float n1 = texture2D(uNoise, a).g;
          float n2 = texture2D(uNoise, b).b;
          float e = 0.02;
          float nx = texture2D(uNoise, b + vec2(e, 0.0)).b - n2;
          float nz = texture2D(uNoise, b + vec2(0.0, e)).b - n2;
          vec3 nrm = normalize(vec3(-nx * 6.0, 1.0, -nz * 6.0));
          vec3 viewDir = normalize(vec3(0.61, 0.5, 0.61));
          vec3 shallow = vec3(0.12, 0.36, 0.42);
          vec3 deep = vec3(0.04, 0.14, 0.3);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 1.8, depth));
          col *= 0.9 + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.16;
          float spec = pow(max(dot(reflect(-uSunDir, nrm), viewDir), 0.0), 60.0);
          col += vec3(0.55, 0.55, 0.45) * spec * 0.35;
          // shore foam bands
          float band = sin(depth * 40.0 - uTime * 1.5 + n1 * 6.0) * 0.5 + 0.5;
          float foam = smoothstep(0.1, 0.0, depth) * (0.35 + 0.4 * band);
          col = mix(col, vec3(0.72, 0.78, 0.76), foam * 0.6);
          float alpha = mix(0.45, 0.94, smoothstep(0.0, 0.6, depth));
          alpha = max(alpha, foam * 0.7);
          float fw = texture2D(uFogTex, p / uMapSize).r;
          float k = fw < 0.5 ? fw * 0.62 : mix(0.31, 1.0, (fw - 0.5) * 2.0);
          col *= k;
          alpha = mix(alpha, 1.0, 1.0 - smoothstep(0.0, 0.3, fw));
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }
      `,
    });
    this.water = new THREE.Mesh(wgeo, this.waterMat);
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
  }
}
