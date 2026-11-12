// Light unless dark was chosen, set before the page paints. Its own file (loaded without
// defer, in the head) so the page needs no inline script, which keeps the security policy strict.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') document.documentElement.setAttribute('data-theme', stored);
  } catch (e) {}
})();
