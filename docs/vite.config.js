import { defineConfig } from 'vite';
import transclude from '@transclude/core';
import config from './transclude.config.js';

export default defineConfig({
  appType: 'custom',
  plugins: [transclude(config)],
});
