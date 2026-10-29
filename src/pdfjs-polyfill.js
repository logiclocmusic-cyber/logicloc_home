/** pdfjs-dist 5.7+ 依赖 Uint8Array.toHex，Electron/旧浏览器需补全 */
export function ensurePdfJsUint8Polyfills() {
  if (!Uint8Array.prototype.toHex) {
    Uint8Array.prototype.toHex = function toHex() {
      let hex = '';
      for (let i = 0; i < this.length; i++) {
        hex += this[i].toString(16).padStart(2, '0');
      }
      return hex;
    };
  }
  if (!Uint8Array.prototype.toBase64) {
    Uint8Array.prototype.toBase64 = function toBase64() {
      let bin = '';
      for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
      return btoa(bin);
    };
  }
  if (!Uint8Array.fromHex) {
    Uint8Array.fromHex = function fromHex(hex) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    };
  }
}
