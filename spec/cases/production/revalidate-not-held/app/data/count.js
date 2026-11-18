const renders = {};

export const count = (name) => (renders[name] = (renders[name] ?? 0) + 1);
