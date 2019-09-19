/** Return promise that is resolved in `delay` ms */
exports.sleep = (delay) => {
  return new Promise((accept) => {
    setTimeout(accept, delay);
  });
};
