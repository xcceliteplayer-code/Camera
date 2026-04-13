/* ══════════════════════════════════════
   WCAM PRO V2 — filters.js
══════════════════════════════════════ */
'use strict';

const Filters = (() => {
  let current = 'none';

  const CSS_FILTERS = ['grayscale(1)','invert(1)','brightness(1.6) contrast(1.1)','sepia(1)','hue-rotate(180deg)','saturate(2.5) contrast(1.2)'];

  const set = (el, filter) => {
    document.querySelectorAll('[data-f]').forEach(e=>e.classList.remove('active'));
    el.classList.add('active');
    current = filter;
    U.log('Filter: '+el.textContent.trim(), 'amber');
  };

  const getCurrent = () => current;
  const isCSSFilter = () => CSS_FILTERS.includes(current);

  return { set, getCurrent, isCSSFilter };
})();
