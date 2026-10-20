// DESIGN.md › Enforcement: colour, font and radius values must come from
// src/styles/tokens.css as var(--…). Shorthands may still carry widths and
// line styles (`border: 1px solid var(--outline)`), never a colour.
const keywords = ['inherit', 'currentColor', 'transparent', '0'];
const shorthand = [
  ...keywords,
  'none',
  'solid',
  'dashed',
  'inset',
  '/^-?[0-9.]+(px|rem|em)$/', // widths and offsets
];

export default {
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      [
        'color',
        'background',
        'background-color',
        'border',
        'border-top',
        'border-right',
        'border-bottom',
        'border-left',
        'border-color',
        'outline',
        'box-shadow',
        'fill',
        'stroke',
        'font',
        'font-family',
        'border-radius',
      ],
      {
        ignoreValues: {
          '': keywords,
          background: shorthand,
          border: shorthand,
          'border-top': shorthand,
          'border-right': shorthand,
          'border-bottom': shorthand,
          'border-left': shorthand,
          outline: shorthand,
          'box-shadow': shorthand,
        },
        ignoreFunctions: false,
      },
    ],
  },
};
