import type { KeyChord } from './types';

export const MOD_CTRL = 1 << 0;
export const MOD_ALT = 1 << 1;
export const MOD_SHIFT = 1 << 2;
export const MOD_WIN = 1 << 3;

export const MOD_LCTRL = 1 << 4;
export const MOD_RCTRL = 1 << 5;
export const MOD_LALT = 1 << 6;
export const MOD_RALT = 1 << 7;
export const MOD_LSHIFT = 1 << 8;
export const MOD_RSHIFT = 1 << 9;
export const MOD_LWIN = 1 << 10;
export const MOD_RWIN = 1 << 11;

export const MOD_GENERIC_MASK = MOD_CTRL | MOD_ALT | MOD_SHIFT | MOD_WIN;
export const MOD_SIDE_MASK = MOD_LCTRL | MOD_RCTRL | MOD_LALT | MOD_RALT | MOD_LSHIFT | MOD_RSHIFT | MOD_LWIN | MOD_RWIN;
export const MOD_ALL = MOD_GENERIC_MASK | MOD_SIDE_MASK;

export const KEY_MAP: Record<number, string> = {
  0x08: 'Backspace',
  0x09: 'Tab',
  0x0C: 'Clear',
  0x0D: 'Enter',
  0x10: 'Shift',
  0x11: 'Ctrl',
  0x12: 'Alt',
  0x13: 'Pause',
  0x14: 'CapsLock',
  0x1B: 'Escape',
  0x20: 'Space',
  0x21: 'PageUp',
  0x22: 'PageDown',
  0x23: 'End',
  0x24: 'Home',
  0x25: 'Left',
  0x26: 'Up',
  0x27: 'Right',
  0x28: 'Down',
  0x2C: 'PrintScreen',
  0x2D: 'Insert',
  0x2E: 'Delete',
  0x2F: 'Help',
  0x5B: 'LWin',
  0x5C: 'RWin',
  0x5D: 'Apps',
  0x5F: 'Sleep',
  0x60: 'Num0',
  0x61: 'Num1',
  0x62: 'Num2',
  0x63: 'Num3',
  0x64: 'Num4',
  0x65: 'Num5',
  0x66: 'Num6',
  0x67: 'Num7',
  0x68: 'Num8',
  0x69: 'Num9',
  0x6A: 'Num*',
  0x6B: 'Num+',
  0x6C: 'Separator',
  0x6D: 'Num-',
  0x6E: 'Num.',
  0x6F: 'Num/',
  0x90: 'NumLock',
  0x91: 'ScrollLock',
  0xA0: 'LShift',
  0xA1: 'RShift',
  0xA2: 'LCtrl',
  0xA3: 'RCtrl',
  0xA4: 'LAlt',
  0xA5: 'RAlt',
  0xA6: 'BrowserBack',
  0xA7: 'BrowserForward',
  0xA8: 'BrowserRefresh',
  0xA9: 'BrowserStop',
  0xAA: 'BrowserSearch',
  0xAB: 'BrowserFavorites',
  0xAC: 'BrowserHome',
  0xAD: 'VolumeMute',
  0xAE: 'VolumeDown',
  0xAF: 'VolumeUp',
  0xB0: 'MediaNext',
  0xB1: 'MediaPrev',
  0xB2: 'MediaStop',
  0xB3: 'MediaPlayPause',
  0xB4: 'LaunchMail',
  0xB5: 'LaunchMedia',
  0xBA: ';',
  0xBB: '=',
  0xBC: ',',
  0xBD: '-',
  0xBE: '.',
  0xBF: '/',
  0xC0: '`',
  0xDB: '[',
  0xDC: '\\',
  0xDD: ']',
  0xDE: "'",
  0xE2: 'OEM102',
};

for (let i = 0x30; i <= 0x39; i++) KEY_MAP[i] = String.fromCharCode(i);
for (let i = 0x41; i <= 0x5A; i++) KEY_MAP[i] = String.fromCharCode(i);
for (let i = 0x70; i <= 0x87; i++) KEY_MAP[i] = `F${i - 0x6F}`;

export function vkToName(vk: number): string {
  return KEY_MAP[vk] ?? `VK_${vk}`;
}

export function nameToVk(name: string): number {
  const normalized = name.trim().toLowerCase();
  for (const [vkStr, keyName] of Object.entries(KEY_MAP)) {
    if (keyName.toLowerCase() === normalized) return Number.parseInt(vkStr, 10);
  }
  if (normalized === 'win') return 0x5B;
  if (normalized.startsWith('vk_')) {
    const parsed = Number.parseInt(normalized.slice(3), 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 255) return parsed;
  }
  return 0;
}

export function isModifierVk(vk: number): boolean {
  return vk === 0x10 || vk === 0x11 || vk === 0x12
    || vk === 0x5B || vk === 0x5C
    || (vk >= 0xA0 && vk <= 0xA5);
}

export function modifierBitForVk(vk: number): number {
  switch (vk) {
    case 0xA2: return MOD_LCTRL;
    case 0xA3: return MOD_RCTRL;
    case 0xA4: return MOD_LALT;
    case 0xA5: return MOD_RALT;
    case 0xA0: return MOD_LSHIFT;
    case 0xA1: return MOD_RSHIFT;
    case 0x5B: return MOD_LWIN;
    case 0x5C: return MOD_RWIN;
    case 0x11: return MOD_CTRL;
    case 0x12: return MOD_ALT;
    case 0x10: return MOD_SHIFT;
    default: return 0;
  }
}

export function genericizeModifierMask(mask: number): number {
  let result = mask & MOD_GENERIC_MASK;
  if (mask & (MOD_LCTRL | MOD_RCTRL)) result |= MOD_CTRL;
  if (mask & (MOD_LALT | MOD_RALT)) result |= MOD_ALT;
  if (mask & (MOD_LSHIFT | MOD_RSHIFT)) result |= MOD_SHIFT;
  if (mask & (MOD_LWIN | MOD_RWIN)) result |= MOD_WIN;
  return result & MOD_GENERIC_MASK;
}

export function modifierNames(mask: number): string[] {
  const names: string[] = [];
  if (mask & MOD_CTRL) names.push('Ctrl');
  else {
    if (mask & MOD_LCTRL) names.push('LCtrl');
    if (mask & MOD_RCTRL) names.push('RCtrl');
  }

  if (mask & MOD_ALT) names.push('Alt');
  else {
    if (mask & MOD_LALT) names.push('LAlt');
    if (mask & MOD_RALT) names.push('RAlt');
  }

  if (mask & MOD_SHIFT) names.push('Shift');
  else {
    if (mask & MOD_LSHIFT) names.push('LShift');
    if (mask & MOD_RSHIFT) names.push('RShift');
  }

  if (mask & MOD_WIN) names.push('Win');
  else {
    if (mask & MOD_LWIN) names.push('LWin');
    if (mask & MOD_RWIN) names.push('RWin');
  }
  return names;
}

export function formatKeyChord(chord: KeyChord): string {
  const parts = modifierNames(chord.modifiers & MOD_ALL);
  if (chord.code !== 0) parts.push(vkToName(chord.code));
  return parts.length > 0 ? parts.join(' + ') : '—';
}

export interface KeyItem {
  vk: number;
  name: string;
}

export const ALL_KEYS: KeyItem[] = Object.entries(KEY_MAP)
  .map(([vkStr, name]) => ({ vk: Number.parseInt(vkStr, 10), name }))
  .filter((item) => !isModifierVk(item.vk))
  .sort((a, b) => a.name.localeCompare(b.name));
