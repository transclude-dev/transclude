// A store with the four methods, whose methods return promises, the way a
// store over the network does, and which records what it was asked.
const entries = new Map();
const asked = (globalThis.storeAsked = []);

export const store = {
  async get(key) {
    asked.push(`get ${key}`);
    return entries.get(key);
  },
  async set(key, entry) {
    asked.push(`set ${key}`);
    entries.set(key, entry);
  },
  async delete(key) {
    asked.push(`delete ${key}`);
    entries.delete(key);
  },
  async deleteByTag(tag) {
    asked.push(`deleteByTag ${tag}`);
    for (const [key, entry] of entries) if (entry.tags?.includes(tag)) entries.delete(key);
  },
};
