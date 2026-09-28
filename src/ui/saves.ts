import type { SaveData } from '../sim/save';

/*
 * The saved-games database: IndexedDB in the player's browser. Two object stores keyed by the same id: 'meta' holds
 * what the save list shows (name, when, realm, map, game time, a small picture), 'data' holds the game snapshot, so
 * listing the saves never reads the (larger) snapshots.
 */

export interface SaveMeta {
  id: string;
  name: string;
  /** Real time the save was made (ms since 1970). */
  savedAt: number;
  /** Game clock at the save (s). */
  gameTime: number;
  realm: string;
  civ: string;
  color: string;
  mapType: string;
  mapSize: number;
  players: string;
  age: string;
  /** The minimap at the moment of saving, as a data URL. */
  thumb: string;
  auto: boolean;
}

/** The single autosave slot, overwritten each time. */
export const AUTOSAVE_ID = 'autosave';

const DB_NAME = 'realms-ascendant';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser cannot store saved games.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('data')) d.createObjectStore('data');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the saved games.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('The save could not be written.'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Stores a save (a new one, or over an existing id). */
export async function writeSave(meta: SaveMeta, data: SaveData): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'data'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('data').put(data, meta.id);
  await done(tx);
}

/** Every save, newest first. */
export async function listSaves(): Promise<SaveMeta[]> {
  const d = await db();
  const all = await request(d.transaction('meta').objectStore('meta').getAll() as IDBRequest<SaveMeta[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readSave(id: string): Promise<SaveData | undefined> {
  const d = await db();
  return request(d.transaction('data').objectStore('data').get(id) as IDBRequest<SaveData | undefined>);
}

export async function deleteSave(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'data'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('data').delete(id);
  await done(tx);
}

export function newSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/* ---------------------------------------------------------------------------------------- */
/* The save list (shared by the main menu and the in-game menu)                              */
/* ---------------------------------------------------------------------------------------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function formatClock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
}

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

/**
 * The list of saves as HTML. Each row carries data-id; buttons carry data-act ('load', 'delete' or 'overwrite').
 * `mode` picks the row's buttons: loading offers Load and Delete, saving offers Save here (overwrite).
 */
export function saveListHtml(saves: SaveMeta[], mode: 'load' | 'save'): string {
  if (!saves.length) return `<div class="save-empty">No saved games yet.</div>`;
  return `<div class="save-list">${saves.map((s) => `
    <div class="save-row" data-id="${esc(s.id)}">
      <img class="save-thumb" src="${s.thumb}" alt="">
      <div class="save-info">
        <div class="save-name">${esc(s.name)}${s.auto ? ' <span class="save-tag">autosave</span>' : ''}</div>
        <div class="save-sub"><span class="save-realm" style="color:${esc(s.color)}">${esc(s.realm)}</span> · ${esc(s.age)} · ${formatClock(s.gameTime)} game time</div>
        <div class="save-sub">${esc(s.players)} · ${esc(s.mapType)} ${s.mapSize}×${s.mapSize} · saved ${when(s.savedAt)}</div>
      </div>
      <div class="save-acts">${mode === 'load'
        ? `<button class="mbtn small" data-act="load">Load</button><button class="mbtn small" data-act="delete">Delete</button>`
        : s.auto ? '' : `<button class="mbtn small" data-act="overwrite">Save here</button>`}</div>
    </div>`).join('')}</div>`;
}
