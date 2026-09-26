export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(bx - ax, bz - az);
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az;
  return dx * dx + dz * dz;
};
/** Shortest signed angle from a to b. */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(a, b) * t;

/** Distance from point to axis-aligned rect [x0,x1]x[z0,z1] (0 if inside). */
export const distToRect = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number => {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  return Math.hypot(dx, dz);
};

export const formatTime = (secs: number): string => {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
};
