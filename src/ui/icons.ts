import * as THREE from 'three';
import type { ArchStyle } from '../data/types';
import { getRig } from '../render/models/units';
import { BAKED_STRIDE, getBakedRig, restPose, sampleClip, type BakedRig } from '../render/models/baked';
import { buildingModel } from '../render/models/buildings';
import { animate, activeVariant, BONE_STRIDE } from '../render/anim';
import { worldUniforms } from '../render/materials';

/* ======================================================================================== */
/* SVG glyph icons                                                                            */
/* ======================================================================================== */

const OUT = '#2a1a08';
const svg = (inner: string, vb = 64): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${inner}</svg>`;

export const RES_ICONS: Record<string, string> = {
  food: svg(`<ellipse cx="30" cy="36" rx="18" ry="16" fill="#b8322a" stroke="${OUT}" stroke-width="3"/>
    <ellipse cx="24" cy="30" rx="6" ry="4" fill="#e86a5a"/>
    <rect x="40" y="12" width="7" height="22" rx="3" transform="rotate(35 44 24)" fill="#f0e6d0" stroke="${OUT}" stroke-width="2.5"/>
    <circle cx="51" cy="11" r="5" fill="#f0e6d0" stroke="${OUT}" stroke-width="2.5"/>`),
  wood: svg(`<rect x="8" y="30" width="48" height="12" rx="6" fill="#8a5a2c" stroke="${OUT}" stroke-width="3"/>
    <rect x="8" y="42" width="48" height="12" rx="6" fill="#7a4a24" stroke="${OUT}" stroke-width="3"/>
    <rect x="14" y="18" width="40" height="12" rx="6" fill="#9a6a34" stroke="${OUT}" stroke-width="3"/>
    <circle cx="54" cy="24" r="6" fill="#e0b870" stroke="${OUT}" stroke-width="2.5"/><circle cx="54" cy="24" r="2" fill="#a07030"/>
    <circle cx="54" cy="48" r="6" fill="#e0b870" stroke="${OUT}" stroke-width="2.5"/><circle cx="54" cy="48" r="2" fill="#a07030"/>`),
  gold: svg(`<ellipse cx="22" cy="44" rx="14" ry="9" fill="#e8b828" stroke="${OUT}" stroke-width="3"/>
    <ellipse cx="42" cy="44" rx="14" ry="9" fill="#d8a018" stroke="${OUT}" stroke-width="3"/>
    <ellipse cx="32" cy="30" rx="15" ry="10" fill="#f4cc3c" stroke="${OUT}" stroke-width="3"/>
    <ellipse cx="28" cy="27" rx="5" ry="3" fill="#fff0a0"/>`),
  stone: svg(`<path d="M8 46 L16 26 L34 22 L44 34 L40 52 L18 54 Z" fill="#9a968c" stroke="${OUT}" stroke-width="3"/>
    <path d="M34 22 L50 18 L58 36 L44 34 Z" fill="#b4b0a6" stroke="${OUT}" stroke-width="3"/>
    <path d="M44 34 L58 36 L54 50 L40 52 Z" fill="#7c786e" stroke="${OUT}" stroke-width="3"/>`),
  pop: svg(`<circle cx="32" cy="18" r="10" fill="#e8c8a0" stroke="${OUT}" stroke-width="3"/>
    <path d="M14 58 C14 36 50 36 50 58 Z" fill="#4a7ab0" stroke="${OUT}" stroke-width="3"/>`),
  time: svg(`<circle cx="32" cy="32" r="24" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><path d="M32 14 V32 L44 40" stroke="${OUT}" stroke-width="4" fill="none" stroke-linecap="round"/>`),
  villager: svg(`<circle cx="32" cy="16" r="9" fill="#e8c8a0" stroke="${OUT}" stroke-width="3"/>
    <path d="M16 58 C16 34 48 34 48 58 Z" fill="#8a6a3a" stroke="${OUT}" stroke-width="3"/>
    <rect x="44" y="20" width="5" height="30" transform="rotate(25 46 35)" fill="#6a4a2a" stroke="${OUT}" stroke-width="2"/>`),
  sword: svg(`<path d="M32 6 L37 12 L37 40 L27 40 L27 12 Z" fill="#d8dce4" stroke="${OUT}" stroke-width="3"/>
    <rect x="18" y="40" width="28" height="6" rx="2" fill="#b08a3a" stroke="${OUT}" stroke-width="3"/>
    <rect x="28" y="46" width="8" height="12" fill="#5a3a1a" stroke="${OUT}" stroke-width="3"/>`),
  shield: svg(`<path d="M32 6 L54 14 C54 36 46 50 32 58 C18 50 10 36 10 14 Z" fill="#8a6a3a" stroke="${OUT}" stroke-width="3"/><path d="M32 12 L48 18 C48 34 42 44 32 51 Z" fill="#b89048"/>`),
  pierce: svg(`<path d="M32 6 L54 14 C54 36 46 50 32 58 C18 50 10 36 10 14 Z" fill="#6a7a8a" stroke="${OUT}" stroke-width="3"/><path d="M14 50 L50 14" stroke="#e8e0d0" stroke-width="4"/><path d="M50 14 L42 16 L48 22 Z" fill="#e8e0d0"/>`),
  range: svg(`<path d="M16 8 C40 16 40 48 16 56" fill="none" stroke="#7a4a1a" stroke-width="5"/><path d="M16 8 L16 56" stroke="#e8e0d0" stroke-width="2"/><path d="M10 32 H56" stroke="${OUT}" stroke-width="3"/><path d="M56 32 L48 27 L48 37 Z" fill="#aaa"/>`),
  los: svg(`<path d="M4 32 C18 12 46 12 60 32 C46 52 18 52 4 32 Z" fill="#e8e0d0" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="32" r="10" fill="#3a6a9a" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="32" r="4" fill="#111"/>`),
  speed: svg(`<path d="M10 44 L40 44 L50 30 L40 30 L44 18 L22 34 L32 34 Z" fill="#e8c040" stroke="${OUT}" stroke-width="3"/>`),
};

type Glyph = string;

const G: Record<string, Glyph> = {
  // ---- commands ----
  stop: `<path d="M22 8 H42 L56 22 V42 L42 56 H22 L8 42 V22 Z" fill="#b82a1e" stroke="${OUT}" stroke-width="3"/><rect x="18" y="28" width="28" height="8" fill="#fff"/>`,
  delete: `<path d="M14 14 L50 50 M50 14 L14 50" stroke="#c82020" stroke-width="10" stroke-linecap="round"/><path d="M14 14 L50 50 M50 14 L14 50" stroke="${OUT}" stroke-width="2" stroke-linecap="round" opacity=".3"/>`,
  buildEco: `<path d="M10 34 L32 14 L54 34 Z" fill="#c0643a" stroke="${OUT}" stroke-width="3"/><rect x="16" y="34" width="32" height="20" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><rect x="28" y="40" width="8" height="14" fill="#6a4a2a"/>`,
  buildMil: `<rect x="18" y="16" width="28" height="40" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><path d="M18 16 V8 H24 V12 H30 V8 H34 V12 H40 V8 H46 V16" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><rect x="28" y="40" width="8" height="16" fill="#3a2a1a"/><path d="M40 20 L52 8" stroke="#d8dce4" stroke-width="4"/>`,
  repair: `<rect x="28" y="24" width="8" height="34" rx="2" transform="rotate(-35 32 40)" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><rect x="18" y="10" width="28" height="14" rx="3" transform="rotate(-35 32 17)" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/>`,
  garrison: `<path d="M12 30 L32 12 L52 30 V56 H12 Z" fill="#c8b890" stroke="${OUT}" stroke-width="3"/><path d="M4 44 H30" stroke="#2a8a2a" stroke-width="7"/><path d="M34 44 L24 34 V54 Z" fill="#2a8a2a"/>`,
  ungarrison: `<path d="M12 30 L32 12 L52 30 V56 H12 Z" fill="#c8b890" stroke="${OUT}" stroke-width="3"/><path d="M26 44 H58" stroke="#c87a1a" stroke-width="7"/><path d="M62 44 L52 34 V54 Z" fill="#c87a1a"/>`,
  attackMove: `<path d="M8 52 L40 20" stroke="#d8dce4" stroke-width="7"/><path d="M40 20 L52 8 L56 12 L44 24 Z" fill="#d8dce4" stroke="${OUT}" stroke-width="2"/><path d="M34 50 H58" stroke="#e8c040" stroke-width="5"/><path d="M60 50 L50 42 V58 Z" fill="#e8c040"/>`,
  patrol: `<path d="M14 24 C20 10 44 10 50 24" fill="none" stroke="#e8c040" stroke-width="5"/><path d="M50 40 C44 54 20 54 14 40" fill="none" stroke="#e8c040" stroke-width="5"/><path d="M54 26 L44 24 L50 16 Z" fill="#e8c040"/><path d="M10 38 L20 40 L14 48 Z" fill="#e8c040"/>`,
  follow: `<ellipse cx="20" cy="44" rx="7" ry="10" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><ellipse cx="42" cy="22" rx="7" ry="10" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/>`,
  aggressive: `<path d="M12 52 L44 20" stroke="#d8dce4" stroke-width="7"/><path d="M52 52 L20 20" stroke="#d8dce4" stroke-width="7"/><circle cx="32" cy="36" r="6" fill="#c82020"/>`,
  defensive: `<path d="M32 6 L54 14 C54 36 46 50 32 58 C18 50 10 36 10 14 Z" fill="#3a6aa8" stroke="${OUT}" stroke-width="3"/><path d="M32 16 V48 M18 30 H46" stroke="#e8e0d0" stroke-width="5"/>`,
  standGround: `<rect x="28" y="8" width="5" height="48" fill="#7a5a38"/><path d="M33 10 H54 L48 20 L54 30 H33 Z" fill="#c82020" stroke="${OUT}" stroke-width="2"/><rect x="16" y="52" width="30" height="6" fill="#6a5a3a"/>`,
  passive: `<rect x="28" y="8" width="5" height="48" fill="#7a5a38"/><path d="M33 10 H54 L48 20 L54 30 H33 Z" fill="#f4f4f4" stroke="${OUT}" stroke-width="2"/>`,
  attackGround: `<circle cx="32" cy="32" r="22" fill="none" stroke="#c82020" stroke-width="5"/><circle cx="32" cy="32" r="11" fill="none" stroke="#c82020" stroke-width="5"/><circle cx="32" cy="32" r="3" fill="#c82020"/>`,
  unpack: `<rect x="8" y="36" width="48" height="10" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><path d="M20 36 L32 8 L44 36" fill="none" stroke="#7a5a38" stroke-width="5"/><path d="M32 12 L54 26" stroke="#5a3a1a" stroke-width="5"/>`,
  pack: `<rect x="6" y="30" width="52" height="12" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><circle cx="16" cy="48" r="7" fill="#4a3420" stroke="${OUT}" stroke-width="3"/><circle cx="48" cy="48" r="7" fill="#4a3420" stroke="${OUT}" stroke-width="3"/>`,
  heal: `<path d="M24 8 H40 V24 H56 V40 H40 V56 H24 V40 H8 V24 H24 Z" fill="#e8e8e8" stroke="${OUT}" stroke-width="3"/><path d="M28 12 H36 V28 H52 V36 H36 V52 H28 V36 H12 V28 H28 Z" fill="#d83a2a"/>`,
  convert: `<circle cx="32" cy="32" r="12" fill="#f4d048" stroke="${OUT}" stroke-width="3"/><g stroke="#f4d048" stroke-width="4">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="${32 + Math.cos((a * Math.PI) / 180) * 17}" y1="${32 + Math.sin((a * Math.PI) / 180) * 17}" x2="${32 + Math.cos((a * Math.PI) / 180) * 27}" y2="${32 + Math.sin((a * Math.PI) / 180) * 27}"/>`).join('')}</g>`,
  back: `<path d="M40 10 L18 32 L40 54" fill="none" stroke="#e8e0d0" stroke-width="8" stroke-linecap="round"/>`,
  townBell: `<path d="M20 44 C20 20 24 12 32 12 C40 12 44 20 44 44 Z" fill="#d4a93a" stroke="${OUT}" stroke-width="3"/><rect x="14" y="44" width="36" height="6" rx="2" fill="#b8862a" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="54" r="4" fill="#8a6a1a"/>`,
  allClear: `<path d="M20 44 C20 20 24 12 32 12 C40 12 44 20 44 44 Z" fill="#8a8a8a" stroke="${OUT}" stroke-width="3"/><path d="M14 30 L26 44 L52 14" fill="none" stroke="#2aa82a" stroke-width="7"/>`,
  rally: `<rect x="18" y="8" width="5" height="50" fill="#7a5a38"/><path d="M23 10 H52 L44 20 L52 30 H23 Z" fill="#2f5fe0" stroke="${OUT}" stroke-width="2"/>`,
  unload: `<rect x="8" y="28" width="48" height="20" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><path d="M32 4 V26" stroke="#c87a1a" stroke-width="6"/><path d="M32 30 L24 20 H40 Z" fill="#c87a1a"/>`,
  sellFood: '', sellWood: '', sellStone: '', buyFood: '', buyWood: '', buyStone: '',
  // ---- technologies ----
  loom: `<ellipse cx="32" cy="18" rx="16" ry="6" fill="#c8a870" stroke="${OUT}" stroke-width="3"/><rect x="18" y="18" width="28" height="28" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><ellipse cx="32" cy="46" rx="16" ry="6" fill="#c8a870" stroke="${OUT}" stroke-width="3"/><path d="M18 26 H46 M18 32 H46 M18 38 H46" stroke="#a8322a" stroke-width="3"/>`,
  wheelbarrow: `<path d="M10 22 H44 L38 40 H16 Z" fill="#8a6a3a" stroke="${OUT}" stroke-width="3"/><circle cx="20" cy="48" r="8" fill="#5a3a1a" stroke="${OUT}" stroke-width="3"/><path d="M40 36 L58 50" stroke="#6a4a2a" stroke-width="5"/>`,
  handCart: `<rect x="8" y="18" width="42" height="20" fill="#8a6a3a" stroke="${OUT}" stroke-width="3"/><circle cx="18" cy="46" r="9" fill="#5a3a1a" stroke="${OUT}" stroke-width="3"/><circle cx="42" cy="46" r="9" fill="#5a3a1a" stroke="${OUT}" stroke-width="3"/><path d="M50 26 H60" stroke="#6a4a2a" stroke-width="5"/>`,
  townWatch: `<path d="M4 32 C18 14 46 14 60 32 C46 50 18 50 4 32 Z" fill="#e8e0d0" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="32" r="10" fill="#3a6a9a" stroke="${OUT}" stroke-width="3"/>`,
  townPatrol: `<path d="M4 32 C18 14 46 14 60 32 C46 50 18 50 4 32 Z" fill="#f4e0a0" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="32" r="10" fill="#9a3a1a" stroke="${OUT}" stroke-width="3"/><path d="M32 4 V12 M32 52 V60" stroke="#e8c040" stroke-width="4"/>`,
  horseCollar: `<path d="M16 50 C8 30 16 10 32 10 C48 10 56 30 48 50" fill="none" stroke="#8a5a2a" stroke-width="9"/><path d="M16 50 C8 30 16 10 32 10 C48 10 56 30 48 50" fill="none" stroke="${OUT}" stroke-width="2"/>`,
  heavyPlow: `<path d="M8 44 L36 44 L52 24" fill="none" stroke="#6a4a2a" stroke-width="6"/><path d="M36 44 L48 56 L20 56 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/>`,
  cropRotation: `<g stroke="${OUT}" stroke-width="2">${[12, 24, 36, 48].map((x) => `<path d="M${x} 58 V24" stroke="#c8a040" stroke-width="3"/><ellipse cx="${x}" cy="18" rx="5" ry="10" fill="#e8c050"/>`).join('')}</g>`,
  axe1: `<rect x="29" y="14" width="6" height="46" fill="#7a5a38" stroke="${OUT}" stroke-width="2"/><path d="M34 10 C52 10 56 26 52 32 L34 28 Z" fill="#b8bcc4" stroke="${OUT}" stroke-width="3"/>`,
  axe2: `<path d="M8 40 H56 V48 H8 Z" fill="#b8bcc4" stroke="${OUT}" stroke-width="3"/><path d="M10 40 L14 34 L18 40 L22 34 L26 40 L30 34 L34 40 L38 34 L42 40 L46 34 L50 40 L54 34 L56 40" fill="#b8bcc4" stroke="${OUT}" stroke-width="2"/><path d="M8 44 C0 30 10 18 18 22" fill="none" stroke="#7a5a38" stroke-width="5"/>`,
  axe3: `<path d="M4 34 H60 V42 H4 Z" fill="#b8bcc4" stroke="${OUT}" stroke-width="3"/><rect x="0" y="26" width="8" height="24" rx="2" fill="#7a5a38" stroke="${OUT}" stroke-width="2"/><rect x="56" y="26" width="8" height="24" rx="2" fill="#7a5a38" stroke="${OUT}" stroke-width="2"/>`,
  gold1: `<path d="M8 50 L44 14" stroke="#7a5a38" stroke-width="6"/><path d="M30 8 C44 14 52 22 56 34 L50 36 C46 26 40 20 28 14 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/><ellipse cx="44" cy="50" rx="12" ry="8" fill="#e8b828" stroke="${OUT}" stroke-width="3"/>`,
  gold2: `<rect x="12" y="10" width="40" height="44" fill="#3a2a1a" stroke="${OUT}" stroke-width="3"/><path d="M12 10 L32 4 L52 10" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><ellipse cx="32" cy="40" rx="12" ry="8" fill="#e8b828" stroke="${OUT}" stroke-width="3"/>`,
  stone1: `<path d="M8 50 L44 14" stroke="#7a5a38" stroke-width="6"/><path d="M30 8 C44 14 52 22 56 34 L50 36 C46 26 40 20 28 14 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/><path d="M32 58 L36 42 L52 40 L58 56 Z" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/>`,
  stone2: `<rect x="12" y="10" width="40" height="44" fill="#3a2a1a" stroke="${OUT}" stroke-width="3"/><path d="M12 10 L32 4 L52 10" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><path d="M20 50 L24 34 L42 32 L46 50 Z" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/>`,
  forging: `<path d="M8 46 H56 L50 38 H14 Z" fill="#4a4a4a" stroke="${OUT}" stroke-width="3"/><rect x="24" y="46" width="16" height="12" fill="#3a3a3a" stroke="${OUT}" stroke-width="3"/><path d="M30 34 L48 10" stroke="#7a5a38" stroke-width="5"/><rect x="42" y="4" width="16" height="10" transform="rotate(38 50 9)" fill="#8a8e96" stroke="${OUT}" stroke-width="2"/>`,
  ironCasting: `<path d="M10 40 H54 L46 58 H18 Z" fill="#4a4a4a" stroke="${OUT}" stroke-width="3"/><path d="M20 40 C20 28 28 24 26 12 C34 18 36 26 34 40 Z" fill="#f08a2a" stroke="${OUT}" stroke-width="2"/><path d="M34 40 C36 30 44 28 42 18 C48 26 48 34 44 40 Z" fill="#f4c040"/>`,
  blastFurnace: `<path d="M16 58 V24 L24 8 H40 L48 24 V58 Z" fill="#6a5a4a" stroke="${OUT}" stroke-width="3"/><path d="M24 58 C24 44 32 40 32 30 C38 38 40 46 40 58 Z" fill="#f0782a"/><path d="M28 58 C28 50 32 46 32 40 C36 46 36 52 36 58 Z" fill="#f8d040"/>`,
  mail1: `<path d="M16 10 H48 L56 24 L48 28 V56 H16 V28 L8 24 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/><path d="M20 20 H44 M20 28 H44 M20 36 H44 M20 44 H44" stroke="#5a5e66" stroke-width="2"/>`,
  mail2: `<path d="M16 10 H48 L56 24 L48 28 V56 H16 V28 L8 24 Z" fill="#a0a4ac" stroke="${OUT}" stroke-width="3"/><path d="M20 16 V52 M26 16 V52 M32 16 V52 M38 16 V52 M44 16 V52" stroke="#6a6e76" stroke-width="2"/>`,
  mail3: `<path d="M16 10 H48 L56 24 L48 28 V56 H16 V28 L8 24 Z" fill="#d0d4dc" stroke="${OUT}" stroke-width="3"/><path d="M16 30 H48 M32 10 V56" stroke="#8a8e96" stroke-width="3"/>`,
  barding1: `<path d="M14 56 C10 38 16 20 30 12 L44 8 L50 20 L40 24 C44 36 40 48 44 56 Z" fill="#8a6a4a" stroke="${OUT}" stroke-width="3"/><path d="M22 30 H40 M20 40 H40" stroke="#5a5e66" stroke-width="3"/>`,
  barding2: `<path d="M14 56 C10 38 16 20 30 12 L44 8 L50 20 L40 24 C44 36 40 48 44 56 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/><path d="M22 28 H40 M20 36 H40 M20 44 H42" stroke="#5a5e66" stroke-width="2"/>`,
  barding3: `<path d="M14 56 C10 38 16 20 30 12 L44 8 L50 20 L40 24 C44 36 40 48 44 56 Z" fill="#d0d4dc" stroke="${OUT}" stroke-width="3"/><path d="M26 16 L36 22" stroke="#8a8e96" stroke-width="4"/>`,
  fletching: `<path d="M8 56 L50 14" stroke="#7a5a38" stroke-width="4"/><path d="M50 14 L40 16 L48 24 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="2"/><path d="M8 56 L6 44 L14 48 Z M8 56 L20 58 L16 50 Z" fill="#e8e0d0" stroke="${OUT}" stroke-width="2"/>`,
  bodkin: `<path d="M8 56 L44 20" stroke="#7a5a38" stroke-width="4"/><path d="M58 6 L36 16 L48 28 Z" fill="#b8bcc4" stroke="${OUT}" stroke-width="3"/>`,
  bracer: `<rect x="16" y="14" width="32" height="38" rx="8" fill="#8a5a2a" stroke="${OUT}" stroke-width="3"/><path d="M16 24 H48 M16 34 H48 M16 44 H48" stroke="#5a3a1a" stroke-width="3"/>`,
  archArmor1: `<path d="M18 10 H46 L52 22 V56 H12 V22 Z" fill="#b89060" stroke="${OUT}" stroke-width="3"/><path d="M32 10 V56" stroke="#8a6a3a" stroke-width="3"/>`,
  archArmor2: `<path d="M18 10 H46 L52 22 V56 H12 V22 Z" fill="#8a5a2a" stroke="${OUT}" stroke-width="3"/><path d="M12 30 H52 M12 42 H52" stroke="#5a3a1a" stroke-width="3"/>`,
  archArmor3: `<path d="M18 10 H46 L52 22 V56 H12 V22 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/>${[18, 26, 34, 42, 50].map((y) => `<circle cx="22" cy="${y}" r="3" fill="none" stroke="#4a4e56" stroke-width="2"/><circle cx="32" cy="${y}" r="3" fill="none" stroke="#4a4e56" stroke-width="2"/><circle cx="42" cy="${y}" r="3" fill="none" stroke="#4a4e56" stroke-width="2"/>`).join('')}`,
  masonry: `${[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => `<rect x="${6 + c * 18 + (r % 2) * 9 - 9 * (r % 2 && c === 0 ? 0 : 0)}" y="${10 + r * 12}" width="16" height="10" fill="#b4b0a6" stroke="${OUT}" stroke-width="2"/>`).join('')).join('')}`,
  architecture: `<path d="M8 20 L32 6 L56 20 Z" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><rect x="12" y="20" width="40" height="5" fill="#d8ccb0" stroke="${OUT}" stroke-width="2"/>${[16, 28, 40].map((x) => `<rect x="${x}" y="25" width="8" height="28" fill="#efe8d8" stroke="${OUT}" stroke-width="2"/>`).join('')}<rect x="8" y="53" width="48" height="6" fill="#d8ccb0" stroke="${OUT}" stroke-width="2"/>`,
  ballistics: `<path d="M6 54 C20 4 44 4 58 54" fill="none" stroke="#e8c040" stroke-width="4" stroke-dasharray="6 4"/><circle cx="52" cy="40" r="6" fill="#4a4a4a" stroke="${OUT}" stroke-width="2"/>`,
  chemistry: `<path d="M24 6 H40 V22 L54 52 C56 58 52 60 48 60 H16 C12 60 8 58 10 52 L24 22 Z" fill="#dce8f0" stroke="${OUT}" stroke-width="3"/><path d="M14 46 H50 L54 52 C56 58 52 58 48 58 H16 C12 58 8 58 10 52 Z" fill="#3aa84a"/>`,
  siegeEngineers: `<rect x="8" y="40" width="48" height="8" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><path d="M26 40 L44 12" stroke="#5a3a1a" stroke-width="6"/><circle cx="46" cy="10" r="6" fill="#8a8680" stroke="${OUT}" stroke-width="2"/><circle cx="16" cy="52" r="6" fill="#4a3420" stroke="${OUT}" stroke-width="2"/><circle cx="48" cy="52" r="6" fill="#4a3420" stroke="${OUT}" stroke-width="2"/>`,
  murderHoles: `<rect x="16" y="10" width="32" height="48" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><path d="M20 20 V14 H26 V20 M30 20 V14 H36 V20 M40 20 V14 H46 V20" fill="#a8a49a" stroke="${OUT}" stroke-width="2"/><path d="M24 30 L22 50 M32 30 L32 52 M40 30 L42 50" stroke="#c82020" stroke-width="3"/>`,
  crane: `<path d="M18 58 L24 10 L30 58" fill="none" stroke="#7a5a38" stroke-width="5"/><path d="M24 12 L58 20" stroke="#7a5a38" stroke-width="5"/><path d="M52 20 V44" stroke="${OUT}" stroke-width="2"/><rect x="46" y="44" width="12" height="10" fill="#a8a49a" stroke="${OUT}" stroke-width="2"/>`,
  guardTower: `<rect x="20" y="16" width="24" height="42" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><path d="M16 16 H48 V8 H42 V12 H36 V8 H28 V12 H22 V8 H16 Z" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><rect x="28" y="26" width="8" height="10" fill="#222"/>`,
  keep: `<rect x="18" y="20" width="28" height="38" fill="#b4b0a6" stroke="${OUT}" stroke-width="3"/><path d="M14 20 L32 4 L50 20 Z" fill="#6a4a8a" stroke="${OUT}" stroke-width="3"/><rect x="28" y="28" width="8" height="10" fill="#222"/>`,
  fortifiedWall: `<rect x="4" y="22" width="56" height="34" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/>${[4, 18, 32, 46].map((x) => `<rect x="${x}" y="12" width="10" height="10" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/>`).join('')}<path d="M4 34 H60 M4 46 H60" stroke="#7a766c" stroke-width="2"/>`,
  heatedShot: `<path d="M8 56 L46 18" stroke="#7a5a38" stroke-width="4"/><path d="M46 18 L36 20 L44 28 Z" fill="#8a8e96"/><path d="M46 20 C50 8 58 12 56 4 C62 12 60 22 50 26 Z" fill="#f08a2a"/>`,
  redemption: `<circle cx="32" cy="32" r="22" fill="#f4e0a0" stroke="${OUT}" stroke-width="3"/><path d="M32 16 V48 M20 28 H44" stroke="#8a6a1a" stroke-width="5"/>`,
  atonement: `<circle cx="32" cy="24" r="12" fill="none" stroke="#e8c040" stroke-width="4"/><path d="M14 58 C14 40 50 40 50 58 Z" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/>`,
  sanctity: `<path d="M32 58 C10 44 8 26 18 16 C24 10 30 14 32 20 C34 14 40 10 46 16 C56 26 54 44 32 58 Z" fill="#d83a4a" stroke="${OUT}" stroke-width="3"/>`,
  fervor: `<path d="M12 50 C20 34 20 20 36 10 C34 22 44 26 52 20 C52 36 44 48 30 54 Z" fill="#f08a2a" stroke="${OUT}" stroke-width="3"/>`,
  blockPrinting: `<rect x="10" y="12" width="44" height="40" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><path d="M32 12 V52" stroke="${OUT}" stroke-width="3"/><path d="M16 22 H28 M16 30 H28 M16 38 H28 M36 22 H48 M36 30 H48 M36 38 H48" stroke="#5a3a1a" stroke-width="2"/>`,
  illumination: `<rect x="24" y="30" width="16" height="26" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><path d="M32 30 C24 22 28 14 32 6 C36 14 40 22 32 30 Z" fill="#f4c040" stroke="${OUT}" stroke-width="2"/>`,
  faith: `<circle cx="32" cy="32" r="24" fill="#6a4a9a" stroke="${OUT}" stroke-width="3"/><path d="M32 12 L37 27 H52 L40 36 L44 51 L32 42 L20 51 L24 36 L12 27 H27 Z" fill="#f4e0a0"/>`,
  theocracy: `<path d="M8 50 L16 20 L26 34 L32 14 L38 34 L48 20 L56 50 Z" fill="#e8c040" stroke="${OUT}" stroke-width="3"/><rect x="8" y="50" width="48" height="6" fill="#b8862a" stroke="${OUT}" stroke-width="2"/>`,
  squires: `<path d="M20 10 H34 V40 L50 42 C56 44 56 54 50 54 H16 V40 Z" fill="#8a5a2a" stroke="${OUT}" stroke-width="3"/><path d="M4 30 H14 M2 40 H12 M6 50 H14" stroke="#e8e0d0" stroke-width="3"/>`,
  tracking: `<ellipse cx="20" cy="44" rx="7" ry="10" fill="#6a4a2a" stroke="${OUT}" stroke-width="2"/><ellipse cx="42" cy="22" rx="7" ry="10" fill="#6a4a2a" stroke="${OUT}" stroke-width="2"/><circle cx="46" cy="46" r="10" fill="none" stroke="#e8e0d0" stroke-width="4"/><path d="M53 53 L60 60" stroke="#e8e0d0" stroke-width="5"/>`,
  arson: `<rect x="28" y="28" width="8" height="32" fill="#7a5a38" stroke="${OUT}" stroke-width="2"/><path d="M32 30 C18 24 22 12 28 4 C30 14 38 12 38 4 C48 16 44 26 32 30 Z" fill="#f08a2a" stroke="${OUT}" stroke-width="2"/>`,
  thumbRing: `<circle cx="32" cy="34" r="18" fill="none" stroke="#d4a93a" stroke-width="8"/><circle cx="32" cy="34" r="18" fill="none" stroke="${OUT}" stroke-width="2"/><circle cx="32" cy="15" r="6" fill="#3a8a6a" stroke="${OUT}" stroke-width="2"/>`,
  parthianTactics: `<path d="M8 50 C18 30 30 30 40 40 L56 30" fill="none" stroke="#8a5a2a" stroke-width="6"/><path d="M40 12 L20 24" stroke="#e8e0d0" stroke-width="3"/><path d="M20 24 L28 24 L24 18 Z" fill="#e8e0d0"/>`,
  bloodlines: `<path d="M14 56 C10 38 16 20 30 12 L44 8 L50 20 L40 24 C44 36 40 48 44 56 Z" fill="#6a3a1a" stroke="${OUT}" stroke-width="3"/><circle cx="40" cy="16" r="2" fill="#fff"/><path d="M50 40 C56 34 60 44 54 50 C50 54 46 48 50 40 Z" fill="#c82020"/>`,
  husbandry: `<path d="M16 52 C8 36 12 14 32 12 C52 14 56 36 48 52 L40 52 C46 38 44 22 32 22 C20 22 18 38 24 52 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="3"/>`,
  hoardings: `<rect x="16" y="24" width="32" height="34" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><rect x="10" y="12" width="44" height="12" fill="#7a5a38" stroke="${OUT}" stroke-width="3"/><path d="M10 12 L32 2 L54 12" fill="#8a4a2a" stroke="${OUT}" stroke-width="3"/>`,
  sappers: `<rect x="30" y="12" width="28" height="44" fill="#a8a49a" stroke="${OUT}" stroke-width="3"/><path d="M4 56 L28 24" stroke="#7a5a38" stroke-width="6"/><path d="M16 18 C28 22 32 28 34 36 L28 36 C26 30 22 26 14 24 Z" fill="#8a8e96" stroke="${OUT}" stroke-width="2"/>`,
  conscription: `<rect x="12" y="8" width="40" height="48" rx="4" fill="#e8dcc0" stroke="${OUT}" stroke-width="3"/><path d="M18 18 H46 M18 26 H46 M18 34 H40" stroke="#5a3a1a" stroke-width="3"/><circle cx="42" cy="46" r="8" fill="#c82020" stroke="${OUT}" stroke-width="2"/>`,
  caravan: `<path d="M8 44 C8 30 20 22 30 28 C36 18 48 18 52 30 L58 34 L54 38 L50 36 V52 H44 V40 H20 V52 H14 V44 Z" fill="#c8a068" stroke="${OUT}" stroke-width="3"/>`,
  guilds: `<path d="M32 8 V56 M12 16 H52" stroke="#8a6a1a" stroke-width="4"/><path d="M4 36 L12 16 L20 36 Z M44 36 L52 16 L60 36 Z" fill="#e8c040" stroke="${OUT}" stroke-width="2"/><rect x="22" y="54" width="20" height="6" fill="#8a6a1a"/>`,
  coinage: `<circle cx="32" cy="32" r="22" fill="#e8b828" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="32" r="15" fill="none" stroke="#b8861a" stroke-width="3"/><path d="M32 22 V42 M26 26 H36 C40 26 40 32 36 32 H28 C24 32 24 38 28 38 H38" fill="none" stroke="#8a5a0a" stroke-width="3"/>`,
  age1: `<path d="M8 52 L14 22 L24 34 L32 12 L40 34 L50 22 L56 52 Z" fill="#b8b8b8" stroke="${OUT}" stroke-width="3"/><text x="32" y="48" font-size="16" font-family="serif" font-weight="bold" text-anchor="middle" fill="${OUT}">II</text>`,
  age2: `<path d="M8 52 L14 22 L24 34 L32 12 L40 34 L50 22 L56 52 Z" fill="#d4a93a" stroke="${OUT}" stroke-width="3"/><text x="32" y="48" font-size="16" font-family="serif" font-weight="bold" text-anchor="middle" fill="${OUT}">III</text>`,
  age3: `<path d="M8 52 L14 22 L24 34 L32 12 L40 34 L50 22 L56 52 Z" fill="#9a4ad8" stroke="${OUT}" stroke-width="3"/><circle cx="32" cy="12" r="4" fill="#f4e0a0"/><text x="32" y="48" font-size="16" font-family="serif" font-weight="bold" text-anchor="middle" fill="#f4e0a0">IV</text>`,
};

// market arrows
for (const [res, col] of [['Food', '#b8322a'], ['Wood', '#8a5a2c'], ['Stone', '#9a968c']] as const) {
  G['sell' + res] = `<circle cx="24" cy="26" r="16" fill="${col}" stroke="${OUT}" stroke-width="3"/><path d="M40 36 H58" stroke="#e8c040" stroke-width="6"/><path d="M60 36 L52 28 V44 Z" fill="#e8c040"/><circle cx="46" cy="52" r="8" fill="#e8b828" stroke="${OUT}" stroke-width="2"/>`;
  G['buy' + res] = `<circle cx="40" cy="26" r="16" fill="${col}" stroke="${OUT}" stroke-width="3"/><path d="M8 36 H26" stroke="#2aa82a" stroke-width="6"/><path d="M28 36 L20 28 V44 Z" fill="#2aa82a"/><circle cx="16" cy="52" r="8" fill="#e8b828" stroke="${OUT}" stroke-width="2"/>`;
}

const CIV_SYMBOLS: Record<string, string> = {
  crescent: `<circle cx="32" cy="22" r="8" fill="currentColor"/><path d="M14 58 L32 30 L50 58 Z" fill="currentColor"/><rect x="18" y="32" width="28" height="5" fill="currentColor"/><path d="M20 12 C24 4 40 4 44 12 C40 8 24 8 20 12 Z" fill="currentColor"/>`,
  eagle: `<path d="M32 12 C28 12 26 16 28 20 L14 18 C8 22 6 30 10 34 L24 30 L22 50 L32 58 L42 50 L40 30 L54 34 C58 30 56 22 50 18 L36 20 C38 16 36 12 32 12 Z" fill="currentColor"/>`,
  sun: `<circle cx="32" cy="32" r="8" fill="currentColor"/>${Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<path d="M${32 + Math.cos(a - 0.1) * 10} ${32 + Math.sin(a - 0.1) * 10} L${32 + Math.cos(a) * 26} ${32 + Math.sin(a) * 26} L${32 + Math.cos(a + 0.1) * 10} ${32 + Math.sin(a + 0.1) * 10} Z" fill="currentColor"/>`; }).join('')}`,
  oak: `<rect x="29" y="34" width="6" height="22" fill="currentColor"/><circle cx="32" cy="24" r="14" fill="currentColor"/><circle cx="20" cy="30" r="9" fill="currentColor"/><circle cx="44" cy="30" r="9" fill="currentColor"/>`,
  wolf: `<path d="M12 12 L22 24 L32 22 L42 24 L52 12 L50 32 C50 44 40 54 32 58 C24 54 14 44 14 32 Z" fill="currentColor"/>`,
  horse: `<path d="M16 58 C12 40 16 24 28 14 L38 6 L44 12 L40 18 C50 22 54 30 50 36 L42 32 C42 42 40 50 44 58 Z" fill="currentColor"/>`,
  bow: `<path d="M18 6 C48 16 48 48 18 58" fill="none" stroke="currentColor" stroke-width="6"/><path d="M18 6 V58" stroke="currentColor" stroke-width="2"/><path d="M8 32 H56 M56 32 L48 26 M56 32 L48 38" stroke="currentColor" stroke-width="4"/>`,
  dragon: `<path d="M8 40 C14 20 30 16 40 24 C46 16 56 18 58 26 C52 24 48 28 50 34 C40 32 34 40 38 48 C28 46 20 52 22 58 C12 54 6 48 8 40 Z" fill="currentColor"/>`,
};

export function civEmblem(civ: { emblem: { bg: string; fg: string; symbol: string } }): string {
  const e = civ.emblem;
  return svg(`<path d="M6 4 H58 V40 C58 52 44 60 32 62 C20 60 6 52 6 40 Z" fill="${e.bg}" stroke="#d4a93a" stroke-width="3"/>
    <g transform="translate(12 10) scale(0.62)" style="color:${e.fg}">${CIV_SYMBOLS[e.symbol] ?? ''}</g>`);
}

const CATEGORY_BG: Record<string, [string, string]> = {
  eco: ['#4a7a3a', '#2a4a1a'],
  mil: ['#8a3a2a', '#4a1a12'],
  def: ['#6a6a72', '#34343a'],
  rel: ['#b8902a', '#6a4a10'],
  age: ['#5a3a8a', '#2a1a4a'],
  cmd: ['#5a4a32', '#2e2414'],
  civ: ['#2a4a7a', '#12243e'],
};

const TECH_CAT: Record<string, string> = {
  loom: 'eco', wheelbarrow: 'eco', handCart: 'eco', townWatch: 'def', townPatrol: 'def', horseCollar: 'eco', heavyPlow: 'eco', cropRotation: 'eco',
  axe1: 'eco', axe2: 'eco', axe3: 'eco', gold1: 'eco', gold2: 'eco', stone1: 'eco', stone2: 'eco', masonry: 'def', architecture: 'def',
  ballistics: 'mil', chemistry: 'mil', siegeEngineers: 'mil', murderHoles: 'def', crane: 'eco', guardTower: 'def', keep: 'def', fortifiedWall: 'def',
  heatedShot: 'def', redemption: 'rel', atonement: 'rel', sanctity: 'rel', fervor: 'rel', blockPrinting: 'rel', illumination: 'rel', faith: 'rel',
  theocracy: 'rel', age1: 'age', age2: 'age', age3: 'age', caravan: 'eco', guilds: 'eco', coinage: 'eco', hoardings: 'def', sappers: 'mil', conscription: 'mil',
};

const dataUri = (s: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
const glyphCache = new Map<string, string>();

/** Framed glyph icon as a data URI. */
export function glyphIcon(key: string, cat?: string): string {
  const ck = key + '|' + (cat ?? '');
  const c = glyphCache.get(ck);
  if (c) return c;
  const g = G[key];
  const category = cat ?? TECH_CAT[key] ?? 'mil';
  const [a, b] = CATEGORY_BG[category] ?? CATEGORY_BG.cmd;
  const body = g ?? `<text x="32" y="40" font-size="22" text-anchor="middle" fill="#f4e0a0" font-family="serif">${key.slice(0, 2)}</text>`;
  const s = svg(`<defs><radialGradient id="bg" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>
    <rect x="0" y="0" width="64" height="64" fill="url(#bg)"/><g>${body}</g>`);
  const uri = dataUri(s);
  glyphCache.set(ck, uri);
  return uri;
}

export function resIcon(key: string): string {
  return dataUri(RES_ICONS[key] ?? RES_ICONS.food);
}

/* ======================================================================================== */
/* Model-rendered icons                                                                       */
/* ======================================================================================== */

let iconRenderer: THREE.WebGLRenderer | null = null;
const modelIconCache = new Map<string, string>();
const ICON_PX = 96;

function getIconRenderer(): THREE.WebGLRenderer {
  if (!iconRenderer) {
    const c = document.createElement('canvas');
    c.width = c.height = ICON_PX;
    iconRenderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    iconRenderer.setSize(ICON_PX, ICON_PX, false);
    iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
    iconRenderer.setClearColor(0x000000, 0);
  }
  return iconRenderer;
}

function snapshot(root: THREE.Object3D, bgA: string, bgB: string, closeUp: boolean): string {
  const r = getIconRenderer();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6a5a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const elev = closeUp ? 0.3 : Math.PI / 6;
  const az = Math.PI / 4 + (closeUp ? -0.35 : 0);
  const dir = new THREE.Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));
  cam.position.copy(center).addScaledVector(dir, 30);
  cam.lookAt(center);
  const ext = Math.max(size.x, size.y, size.z) * (closeUp ? 0.5 : 0.62);
  cam.left = -ext;
  cam.right = ext;
  cam.top = ext;
  cam.bottom = -ext;
  cam.updateProjectionMatrix();
  // detail texture needed by building materials
  void worldUniforms;
  r.render(scene, cam);
  const c2 = document.createElement('canvas');
  c2.width = c2.height = ICON_PX;
  const ctx = c2.getContext('2d')!;
  const grd = ctx.createRadialGradient(ICON_PX * 0.35, ICON_PX * 0.3, 4, ICON_PX / 2, ICON_PX / 2, ICON_PX * 0.75);
  grd.addColorStop(0, bgA);
  grd.addColorStop(1, bgB);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, ICON_PX, ICON_PX);
  ctx.drawImage(r.domElement, 0, 0);
  scene.remove(root);
  return c2.toDataURL('image/png');
}

/** Portrait of a baked unit (villager, soldier, horseman, animal) in its standing pose. */
function bakedUnitIcon(rig: BakedRig, color: number): string {
  const pose = new Float32Array(rig.bones.length * BAKED_STRIDE);
  restPose(pose, rig.bones.length);
  const kind = rig.meta.kind ?? (rig.id === 'scout' ? 'scout' : 'villager');
  const villager = kind !== 'scout';
  for (const name of kind === 'villager' ? ['idle:axe'] : kind === 'soldier' ? ['idle'] : kind === 'animal' ? ['stand'] : kind === 'siege' ? ['idle'] : ['horse:stand', 'rider:hold']) {
    const clip = rig.clips.get(name);
    if (clip) sampleClip(clip, 0, pose);
  }
  const world: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  rig.bones.forEach((b, i) => {
    const o = i * BAKED_STRIDE;
    const pp = b.parent >= 0 ? rig.bones[b.parent].pivot : [0, 0, 0];
    q.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
    const local = new THREE.Matrix4().compose(p.set(b.pivot[0] - pp[0] + pose[o + 4], b.pivot[1] - pp[1] + pose[o + 5], b.pivot[2] - pp[2] + pose[o + 6]), q, one);
    world.push(b.parent < 0 ? local : new THREE.Matrix4().multiplyMatrices(world[b.parent], local));
  });
  const root = new THREE.Group();
  const matN = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matP = new THREE.MeshLambertMaterial({ vertexColors: true, color });
  for (const part of rig.parts) {
    // a villager is shown with an axe, a trebuchet standing
    if (part.variant && part.variant !== 'unpacked' && (kind !== 'villager' || part.variant !== 'tool:axe')) continue;
    if (part.variant && part.variant !== 'unpacked' && !villager) continue;
    const m = new THREE.Mesh(part.geo, part.pc ? matP : matN);
    m.matrixAutoUpdate = false;
    m.matrix.copy(world[part.bone]);
    root.add(m);
  }
  root.rotation.y = -0.5;
  if (!villager) root.scale.setScalar(0.86);   // the new horse is a little larger than the old one
  return snapshot(root, '#6a5a44', '#2a2218', villager);
}

export function unitIcon(model: string, color: number): string {
  const key = model + '|' + color;
  const c = modelIconCache.get(key);
  if (c) return c;
  const baked = getBakedRig(model);
  if (baked) {
    const uri = bakedUnitIcon(baked, color);
    modelIconCache.set(key, uri);
    return uri;
  }
  const rig = getRig(model);
  const pose = new Float32Array(rig.bones.length * BONE_STRIDE);
  animate(rig, { anim: 'idle', t: 0, time: 0, speed: 1, moving: false, attackDelay: 0.4, reload: 2, tool: model.startsWith('villager') ? 'axe' : null, seed: 0, packed: false }, pose);
  const world: THREE.Matrix4[] = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  rig.bones.forEach((b, i) => {
    const o = i * BONE_STRIDE;
    e.set(pose[o], pose[o + 1], pose[o + 2]);
    q.setFromEuler(e);
    const local = new THREE.Matrix4().compose(p.set(b.pivot[0] + pose[o + 3], b.pivot[1] + pose[o + 4], b.pivot[2] + pose[o + 5]), q, s.set(1, 1, 1));
    world.push(b.parent < 0 ? local : new THREE.Matrix4().multiplyMatrices(world[b.parent], local));
  });
  const root = new THREE.Group();
  const matN = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matP = new THREE.MeshLambertMaterial({ vertexColors: true, color });
  for (const part of rig.parts) {
    if (!activeVariant(rig, part.variant, model.startsWith('villager') ? 'axe' : null, null, false, false, false)) continue;
    const m = new THREE.Mesh(part.geo, part.pc ? matP : matN);
    m.matrixAutoUpdate = false;
    m.matrix.copy(world[part.bone]);
    root.add(m);
  }
  root.rotation.y = -0.5;
  const uri = snapshot(root, '#6a5a44', '#2a2218', !rig.mounted && rig.style === 'human');
  modelIconCache.set(key, uri);
  return uri;
}

export function buildingIcon(type: string, style: ArchStyle, color: number): string {
  const key = 'b:' + type + '|' + style + '|' + color;
  const c = modelIconCache.get(key);
  if (c) return c;
  const model = buildingModel(type, style);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(model.main, new THREE.MeshLambertMaterial({ vertexColors: true })));
  root.add(new THREE.Mesh(model.pc, new THREE.MeshLambertMaterial({ vertexColors: true, color: type === 'farm' ? 0x8ac050 : color })));
  if (model.sails) {
    const s = new THREE.Mesh(model.sails.geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    s.position.set(...model.sails.pivot);
    s.rotation.z = 0.4;
    root.add(s);
  }
  const uri = snapshot(root, '#4a6a8a', '#1a2a3a', false);
  modelIconCache.set(key, uri);
  return uri;
}

/** Icon for any tech (glyph, unit upgrade or unique tech). */
export function techIcon(icon: string, color: number, civEmblemSvg?: string): string {
  if (icon.startsWith('unit:')) {
    const model = icon.slice(5);
    return unitIcon(model, color);
  }
  if (icon.startsWith('ut:')) return civEmblemSvg ? dataUri(civEmblemSvg) : glyphIcon('theocracy', 'civ');
  return glyphIcon(icon);
}
