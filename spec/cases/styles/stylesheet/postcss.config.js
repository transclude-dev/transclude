// A plugin written out here, so the case needs no package: it turns the
// made-up `brand` color into a real one.
const brand = {
  postcssPlugin: 'brand',
  Declaration(decl) {
    if (decl.value === 'brand') decl.value = 'rebeccapurple';
  },
};

export default { plugins: [brand] };
