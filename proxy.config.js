const TARGET = 'https://labs-dev.ecap-epm.de';

/**
 * ECAP's load balancer rejects state-changing requests (POST) with a bare,
 * bodyless 403 when Origin/Referer don't match the real tenant domain.
 * The dev server runs on localhost:4200, so the browser sets those headers
 * to localhost — changeOrigin only rewrites Host, not Origin/Referer, so
 * they have to be overridden explicitly here before the request leaves the
 * proxy. Confirmed live: identical account succeeds in ECAP's native UI
 * (real Origin) and fails only through this proxy (localhost Origin).
 */
module.exports = {
  '/networking': {
    target: TARGET,
    secure: false,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', TARGET);
        proxyReq.setHeader('referer', `${TARGET}/`);
      });
    }
  }
};
