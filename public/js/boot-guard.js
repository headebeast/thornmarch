// Classic (non-module) script: it must run even where the game itself cannot.
//  · an old browser with no ES-module support gets a clear message instead of an endless loading bar
//  · if the game has not finished starting after a while (flaky network, blocked script), the loading screen says so
//    and offers a reload instead of hanging silently

(function () {
  var status = function () {
    return document.getElementById('loading-status');
  };
  var fail = function (text) {
    var el = status();
    if (!el) return;
    el.textContent = text;
    el.style.color = '#ff8a7a';
    var bar = document.querySelector('.loading-bar');
    if (bar) bar.style.display = 'none';
    var overlay = document.getElementById('loading-overlay');
    if (overlay && !document.getElementById('loading-reload')) {
      var b = document.createElement('button');
      b.id = 'loading-reload';
      b.textContent = 'Reload';
      b.className = 'btn btn-gold';
      b.style.marginTop = '18px';
      b.onclick = function () {
        location.reload();
      };
      overlay.appendChild(b);
    }
  };
  window.__aeiiBootFailed = fail;

  var modules = 'noModule' in document.createElement('script');
  var canvas = !!document.createElement('canvas').getContext;
  if (!modules || !canvas || typeof Promise === 'undefined' || typeof fetch === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      fail('This browser is too old to run the game. Please update Chrome, Edge, Firefox or Safari.');
    });
    return;
  }

  setTimeout(function () {
    if (!window.__aeiiBooted) fail('The game is taking longer than expected to load. Check your connection and reload.');
  }, 25000);
})();
