const TABLE = (() => {
  const t = new Int16Array(128).fill(-1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  return t;
})();

/** Base64 text to bytes. Written out here because it is quicker than going through a string of characters, and every phone engine differs on `atob`. */
export function decodeBase64(text: string): Uint8Array {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '=' || text[end - 1] === '\n' || text[end - 1] === '\r')) end--;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let bits = 0, acc = 0, o = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? TABLE[code] : -1;
    if (v < 0) continue; // line breaks and anything else that is not part of the data
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; acc &= (1 << bits) - 1; }
  }
  return o === out.length ? out : out.slice(0, o);
}
