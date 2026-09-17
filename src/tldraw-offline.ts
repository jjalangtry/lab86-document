// tldraw sends a usage beacon to its CDN with a fetch that has no error handler. The app
// makes no network requests, so that host gets an empty local answer instead of an error.
// This module must be imported before tldraw, because tldraw binds fetch when it loads.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://cdn.tldraw.com/')) return Promise.resolve(new Response(null, { status: 204 }));
  return nativeFetch(input, init);
};
export {};
