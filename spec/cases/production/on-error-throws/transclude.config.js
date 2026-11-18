export default {
  onError: () => {
    throw new Error('the reporter is down');
  },
};
