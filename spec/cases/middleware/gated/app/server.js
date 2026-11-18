// app/server.js
export const gated = ['/premium', '/api/*'];

const member = async (c, next) => {
  if (!c.req.header('cookie')?.includes('member=1')) return c.text('members only', 401);
  await next();
};

const requireSubscription = member;
const requirePayment = member;

export default (app) => {
  app.use('/premium', requireSubscription);
  app.use('/api/*', requirePayment);
};
