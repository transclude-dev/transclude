export default {
  onError: (error, { request, url, method, route, phase }) => {
    console.error(JSON.stringify({ error: error.message, request: request instanceof Request, url, method, route, phase }));
  },
};
