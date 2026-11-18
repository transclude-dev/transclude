// Only the plugin. The commands build the rest of the config.
const greeting = {
  name: 'greeting',
  resolveId: (id) => (id === 'virtual:greeting' ? '\0virtual:greeting' : null),
  load: (id) => (id === '\0virtual:greeting' ? "export default 'Hello from a plugin';" : null),
};

export default {
  plugins: [greeting],
};
