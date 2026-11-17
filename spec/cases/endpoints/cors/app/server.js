import { cors } from 'hono/cors';

export default (app) => {
  app.use('/api/*', cors({ origin: 'https://app.example' }));
};
