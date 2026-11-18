// A store with the four methods, which records what it was asked.
const entries = new Map();
const asked = (globalThis.storeAsked = []);

export const store = {
  get(key) {
    asked.push(`get ${key}`);
    return entries.get(key);
  },
  set(key, entry) {
    asked.push(`set ${key}`);
    entries.set(key, entry);
  },
  delete(key) {
    asked.push(`delete ${key}`);
    entries.delete(key);
  },
  deleteByTag(tag) {
    asked.push(`deleteByTag ${tag}`);
    for (const [key, entry] of entries) if (entry.tags?.includes(tag)) entries.delete(key);
  },
};
