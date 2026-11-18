export default {
  onError: (error, { url, phase }) => {
    console.error(JSON.stringify({ error: error.message, url, phase }));
  },
};
