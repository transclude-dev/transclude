// app/lib/analytics.js
let views = 0;

export const viewsSoFar = () => views;

// Slow on purpose: the page must not wait for it.
export const recordView = () =>
  new Promise((done) => {
    setTimeout(() => {
      views++;
      done();
    }, 50);
  });
