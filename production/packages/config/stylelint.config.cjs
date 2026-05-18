/**
 * Shared stylelint config for the monorepo.
 *
 * ADR-0006 mandates exactly one CI gate: "No fixed `px` font sizes for text.
 * Use `rem` + relative leading." We scope the config to that rule only —
 * stylistic concerns like spacing, ordering, and short-hand are out of scope
 * for this gate; they belong in prettier (which we already run).
 */
module.exports = {
  rules: {
    'declaration-property-unit-disallowed-list': [
      {
        'font-size': ['px'],
        'line-height': ['px'],
        'letter-spacing': ['px'],
      },
      {
        message: 'ADR-0006: use rem/em for typography, not px.',
        severity: 'error',
      },
    ],
  },
};
