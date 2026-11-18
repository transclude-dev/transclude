// app/server.js
const LOCALES = ['en', 'cy'];

export default (app) => {
  app.get('/', (c) => {
    const header = c.req.header('accept-language') ?? '';
    const wanted = header.split(',').map((one) => one.split(';')[0].trim().slice(0, 2));
    const found = wanted.find((code) => LOCALES.includes(code)) ?? 'en';

    return c.redirect(`/${found}`, 302);
  });
};
