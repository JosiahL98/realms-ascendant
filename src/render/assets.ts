import * as THREE from 'three';

/** Photo textures (CC0, Poly Haven) loaded at startup; null entries fall back to procedural textures. */
export interface TextureAssets {
  terrain: THREE.DataArrayTexture | null;
  detail: THREE.DataArrayTexture | null;
}

const TERRAIN_FILES = ['0_grass', '1_steppe', '2_dirt', '3_sand', '4_forest', '5_shallows', '6_waterbed', '7_deepbed', '8_snow', '9_road', '10_rock'];
const DETAIL_FILES = ['1_stone', '2_planks', '3_thatch', '4_tiles', '5_plaster', '6_brick', '7_logs'];

let cache: Promise<TextureAssets> | null = null;

async function loadImage(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob());
}

function pixels(img: CanvasImageSource, size: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function arrayTexture(layers: Uint8ClampedArray[], size: number, srgb: boolean): THREE.DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function loadTextureAssets(): Promise<TextureAssets> {
  if (!cache) {
    cache = (async () => {
      let terrain: THREE.DataArrayTexture | null = null;
      let detail: THREE.DataArrayTexture | null = null;
      try {
        const imgs = await Promise.all(TERRAIN_FILES.map((f) => loadImage(`textures/terrain/${f}.webp`)));
        terrain = arrayTexture(imgs.map((im) => pixels(im, 512)), 512, true);
      } catch (e) {
        console.warn('terrain textures unavailable, using procedural ones', e);
      }
      try {
        const imgs = await Promise.all(DETAIL_FILES.map((f) => loadImage(`textures/detail/${f}.webp`)));
        const layers = imgs.map((im) => pixels(im, 256));
        // layer 8 (cloth) stays procedural: a fine neutral weave
        const cloth = new Uint8ClampedArray(256 * 256 * 4);
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) {
            const v = 128 + ((x + y) % 4 === 0 ? -6 : 2) + ((x * 7 + y * 13) % 5) - 2;
            const i = (y * 256 + x) * 4;
            cloth[i] = cloth[i + 1] = cloth[i + 2] = v;
            cloth[i + 3] = 255;
          }
        layers.push(cloth);
        detail = arrayTexture(layers, 256, false);
      } catch (e) {
        console.warn('detail textures unavailable, using procedural ones', e);
      }
      return { terrain, detail };
    })();
  }
  return cache;
}
