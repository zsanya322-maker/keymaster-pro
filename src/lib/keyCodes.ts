export const KEY_MAP: Record<number, string> = {
  0x14: "CapsLock",
  0x1B: "Escape",
  0x20: "Space",
  0x0D: "Enter",
  0x08: "Backspace",
  0x09: "Tab",
  0x2E: "Delete",
  0x2D: "Insert",
  0x21: "PageUp",
  0x22: "PageDown",
  0x23: "End",
  0x24: "Home",
  0x25: "Left",
  0x26: "Up",
  0x27: "Right",
  0x28: "Down",
  0xAD: "VolumeMute",
  0xAE: "VolumeDown",
  0xAF: "VolumeUp",
  0x12: "Alt",
  0xA4: "LAlt",
  0xA5: "RAlt",
  0x11: "Ctrl",
  0xA2: "LCtrl",
  0xA3: "RCtrl",
  0x10: "Shift",
  0xA0: "LShift",
  0xA1: "RShift",
  0x5B: "LWin",
  0x5C: "RWin",
  0x70: "F1",
  0x71: "F2",
  0x72: "F3",
  0x73: "F4",
  0x74: "F5",
  0x75: "F6",
  0x76: "F7",
  0x77: "F8",
  0x78: "F9",
  0x79: "F10",
  0x7A: "F11",
  0x7B: "F12",
};

// Add A-Z (0x41 to 0x5A)
for (let i = 0x41; i <= 0x5A; i++) {
  KEY_MAP[i] = String.fromCharCode(i);
}

// Add 0-9 (0x30 to 0x39)
for (let i = 0x30; i <= 0x39; i++) {
  KEY_MAP[i] = String.fromCharCode(i);
}

export function vkToName(vk: number): string {
  if (KEY_MAP[vk]) {
    return KEY_MAP[vk];
  }
  if (vk === 0x5B || vk === 0x5C) return "Win";
  if (vk === 0x12 || vk === 0xA4 || vk === 0xA5) return "Alt";
  if (vk === 0x11 || vk === 0xA2 || vk === 0xA3) return "Ctrl";
  if (vk === 0x10 || vk === 0xA0 || vk === 0xA1) return "Shift";
  return `VK_${vk}`;
}

export function nameToVk(name: string): number {
  for (const [vkStr, keyName] of Object.entries(KEY_MAP)) {
    if (keyName.toLowerCase() === name.toLowerCase()) {
      return parseInt(vkStr, 10);
    }
  }
  if (name.toLowerCase() === "win") return 0x5B;
  if (name.toLowerCase() === "alt") return 0x12;
  if (name.toLowerCase() === "ctrl") return 0x11;
  if (name.toLowerCase() === "shift") return 0x10;
  if (name.startsWith("VK_")) {
    const parsed = parseInt(name.substring(3), 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

export interface KeyItem {
  vk: number;
  name: string;
}

export const ALL_KEYS: KeyItem[] = Object.entries(KEY_MAP).map(([vkStr, name]) => ({
  vk: parseInt(vkStr, 10),
  name,
})).sort((a, b) => a.name.localeCompare(b.name));
