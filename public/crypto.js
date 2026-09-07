// 端到端加密工具：房间密钥只在浏览器，服务端只经手密文。
// 依赖全局 sjcl（public/vendor/sjcl.min.js，在本模块之前以普通 <script> 载入）。
// 随机数用 crypto.getRandomValues —— 它在普通 http 下也可用，只有 crypto.subtle 被禁。

const sjcl = window.sjcl;
const TAG_BITS = 128;

function randomBytes(n) {
  const u8 = new Uint8Array(n);
  crypto.getRandomValues(u8);
  return u8;
}

// Uint8Array <-> sjcl bitArray（该精简构建未含 codec.bytes，这里自己实现）
function bytesToBits(u8) {
  const bits = [];
  let word = 0;
  let i = 0;
  for (; i < u8.length; i++) {
    word = (word << 8) | u8[i];
    if ((i & 3) === 3) { bits.push(word | 0); word = 0; }
  }
  const rem = u8.length & 3;
  if (rem) bits.push(sjcl.bitArray.partial(rem * 8, word)); // partial 会把低位对齐到高位
  return bits;
}

function bitsToBytes(bits) {
  const out = [];
  const len = sjcl.bitArray.bitLength(bits);
  let tmp = 0;
  for (let i = 0; i < len / 8; i++) {
    if ((i & 3) === 0) tmp = bits[i >>> 2];
    out.push((tmp >>> 24) & 0xff);
    tmp <<= 8;
  }
  return new Uint8Array(out);
}

/** 生成一把新房间密钥，返回可放进链接 #k= 的 base64url 字符串 */
export function newKeyString() {
  return sjcl.codec.base64url.fromBits(bytesToBits(randomBytes(32)));
}

/** 把 base64url 字符串还原成内部密钥（bitArray）；非法则抛错 */
export function importKey(str) {
  const bits = sjcl.codec.base64url.toBits(str);
  if (sjcl.bitArray.bitLength(bits) !== 256) throw new Error('密钥长度不对');
  return bits;
}

/** 加密文本，返回 "ivBase64:ctBase64"；aad 绑定发送者，防止密文被改挂到别人名下 */
export function encryptText(key, aad, text) {
  const aes = new sjcl.cipher.aes(key);
  const iv = bytesToBits(randomBytes(12));
  const ct = sjcl.mode.gcm.encrypt(aes, sjcl.codec.utf8String.toBits(text), iv, sjcl.codec.utf8String.toBits(aad || ''), TAG_BITS);
  return `${sjcl.codec.base64.fromBits(iv)}:${sjcl.codec.base64.fromBits(ct)}`;
}

/** 解密文本；解不开（密钥错 / 被篡改）抛错 */
export function decryptText(key, aad, packed) {
  const sep = packed.indexOf(':');
  if (sep < 0) throw new Error('密文格式错误');
  const iv = sjcl.codec.base64.toBits(packed.slice(0, sep));
  const ct = sjcl.codec.base64.toBits(packed.slice(sep + 1));
  const aes = new sjcl.cipher.aes(key);
  const pt = sjcl.mode.gcm.decrypt(aes, ct, iv, sjcl.codec.utf8String.toBits(aad || ''), TAG_BITS);
  return sjcl.codec.utf8String.fromBits(pt);
}

/** 加密二进制：返回 [12 字节 IV | 密文] 的 Uint8Array */
export function encryptBytes(key, aad, u8) {
  const aes = new sjcl.cipher.aes(key);
  const ivBits = bytesToBits(randomBytes(12));
  const ct = sjcl.mode.gcm.encrypt(aes, bytesToBits(u8), ivBits, sjcl.codec.utf8String.toBits(aad || ''), TAG_BITS);
  const ivBytes = bitsToBytes(ivBits);
  const ctBytes = bitsToBytes(ct);
  const out = new Uint8Array(ivBytes.length + ctBytes.length);
  out.set(ivBytes, 0);
  out.set(ctBytes, ivBytes.length);
  return out;
}

/** 解密二进制：输入 [12 字节 IV | 密文] */
export function decryptBytes(key, aad, u8) {
  const iv = bytesToBits(u8.slice(0, 12));
  const ct = bytesToBits(u8.slice(12));
  const aes = new sjcl.cipher.aes(key);
  return bitsToBytes(sjcl.mode.gcm.decrypt(aes, ct, iv, sjcl.codec.utf8String.toBits(aad || ''), TAG_BITS));
}

/** 是否具备加密所需的一切（sjcl + getRandomValues） */
export function cryptoReady() {
  return !!(sjcl && sjcl.mode && sjcl.mode.gcm && window.crypto && crypto.getRandomValues);
}
