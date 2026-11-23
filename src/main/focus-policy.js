'use strict';

/**
 * @param {{autoHide?: boolean, isCsp?: boolean, isOwn?: boolean, grace?: boolean}} state
 * @returns {'show'|'keep'|'hide'}
 */
function focusAction(state) {
  const s = state || {};

  if (s.autoHide === false) return 'keep';
  if (s.isCsp) return 'show';

  if (s.isOwn) return 'keep';

  if (s.grace) return 'keep';
  return 'hide';
}

module.exports = { focusAction };
