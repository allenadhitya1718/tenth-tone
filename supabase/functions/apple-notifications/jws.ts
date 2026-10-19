// =============================================================
// Apple-signed JWS verification (App Store Server Notifications V2 and the
// signedTransactionInfo inside them). No Deno-only APIs, so it can be tested
// under Node too.
//
// A JWS from Apple carries its certificate chain in the header:
//   x5c = [ leaf, Apple Worldwide Developer Relations intermediate, Apple Root CA - G3 ]
// Anybody can put any chain in a header, so every link is checked here and
// the trust anchor is the Apple Root CA - G3 certificate pinned by its SHA-256
// fingerprint (APPLE_ROOT_CA_G3_SHA256). Pinning the hash of the DER is
// equivalent to embedding the certificate and comparing it byte for byte.
// Apple publishes the certificate and its fingerprint at
//   https://www.apple.com/certificateauthority/  ("Apple Root CA - G3")
// Check it once:
//   curl -s https://www.apple.com/certificateauthority/AppleRootCA-G3.cer | sha256sum
//
// What verifyAppleJws() requires, failing closed on anything else:
//   * header alg exactly ES256, no "crit", x5c of exactly 3 certificates;
//   * x5c[2] is byte-for-byte Apple Root CA - G3 (fingerprint), and its
//     self-signature verifies;
//   * x5c[1] is issued by the root (issuer == root subject, signature verifies
//     with the root's key), is a CA (basicConstraints cA = TRUE) and carries
//     Apple's WWDR intermediate marker OID 1.2.840.113635.100.6.2.1;
//   * x5c[0] is issued by x5c[1] (same checks), is NOT a CA, carries Apple's
//     App Store receipt-signing marker OID 1.2.840.113635.100.6.11.1, and
//     has a P-256 key;
//   * every certificate is within its validity period now;
//   * the JWS signature (ES256, r||s) verifies with the leaf key.
// Revocation (OCSP) is not checked; Apple's own library makes that optional.
// =============================================================

// Apple Root CA - G3, SHA-256 of the DER certificate.
export const APPLE_ROOT_CA_G3_SHA256 =
  '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_P256 = '1.2.840.10045.3.1.7';
const OID_P384 = '1.3.132.0.34';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_ECDSA_SHA384 = '1.2.840.10045.4.3.3';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_APPLE_WWDR_INTERMEDIATE = '1.2.840.113635.100.6.2.1';
const OID_APPLE_RECEIPT_SIGNING = '1.2.840.113635.100.6.11.1';

export class JwsError extends Error {}
const fail = (m: string): never => { throw new JwsError(m); };

// ---------- encoding ----------
function b64ToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) fail('bad base64');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) fail('bad base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  if (padded.length === 0) return new Uint8Array(0);
  return b64ToBytes(padded);
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function bytesEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
// Copy into a fresh ArrayBuffer (WebCrypto wants a BufferSource that is
// exactly the bytes, not a view into a larger buffer).
const buf = (b: Uint8Array) => b.slice().buffer;

// ---------- minimal strict DER reader ----------
type Tlv = { tag: number; start: number; end: number; full: Uint8Array; content: Uint8Array };

function readTlv(der: Uint8Array, pos: number, limit: number): Tlv {
  if (pos + 2 > limit) fail('DER truncated');
  const tag = der[pos];
  if ((tag & 0x1f) === 0x1f) fail('DER multi-byte tag');
  let len = der[pos + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) fail('DER bad length');
    if (pos + 2 + n > limit) fail('DER truncated');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[pos + 2 + i];
    if (len < 0x80 || (n > 1 && der[pos + 2] === 0)) fail('DER non-minimal length');
    hdr += n;
  }
  const start = pos + hdr;
  const end = start + len;
  if (end > limit) fail('DER truncated');
  return { tag, start, end, full: der.subarray(pos, end), content: der.subarray(start, end) };
}
function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = parent.start;
  while (p < parent.end) {
    const t = readTlv(der, p, parent.end);
    out.push(t);
    p = t.end;
  }
  return out;
}
function expectTag(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) fail(`DER: expected ${what}`);
  return t as Tlv;
}
function decodeOid(b: Uint8Array): string {
  if (b.length === 0) fail('DER empty OID');
  const parts: number[] = [];
  let v = 0;
  for (let i = 0; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (v > Number.MAX_SAFE_INTEGER / 128) fail('DER OID too large');
    if (!(b[i] & 0x80)) {
      if (parts.length === 0) {
        const first = v < 80 ? Math.floor(v / 40) : 2;
        parts.push(first, v - first * 40);
      } else parts.push(v);
      v = 0;
    } else if (i === b.length - 1) fail('DER OID truncated');
  }
  return parts.join('.');
}
function decodeTime(t: Tlv): number {
  const s = new TextDecoder().decode(t.content);
  let m: RegExpMatchArray | null;
  let year: number;
  if (t.tag === 0x17) {                       // UTCTime YYMMDDHHMMSSZ
    m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) fail('bad UTCTime');
    const yy = Number(m![1]);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
  } else if (t.tag === 0x18) {                // GeneralizedTime YYYYMMDDHHMMSSZ
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) fail('bad GeneralizedTime');
    year = Number(m![1]);
  } else {
    return fail('bad time');
  }
  return Date.UTC(year, Number(m![2]) - 1, Number(m![3]), Number(m![4]), Number(m![5]), Number(m![6]));
}

// ---------- X.509 ----------
type Cert = {
  der: Uint8Array;
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;       // DER ECDSA-Sig-Value
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  spki: Uint8Array;
  curve: string;
  isCa: boolean;
  extOids: Set<string>;
};

function algOid(der: Uint8Array, t: Tlv): string {
  const parts = children(der, expectTag(t, 0x30, 'AlgorithmIdentifier'));
  return decodeOid(expectTag(parts[0], 0x06, 'algorithm OID').content);
}

export function parseCert(der: Uint8Array): Cert {
  const top = readTlv(der, 0, der.length);
  if (top.tag !== 0x30 || top.end !== der.length) fail('certificate is not one SEQUENCE');
  const [tbsT, sigAlgT, sigT, ...rest] = children(der, top);
  if (rest.length) fail('certificate has trailing fields');
  expectTag(tbsT, 0x30, 'tbsCertificate');
  const sigAlg = algOid(der, sigAlgT);
  expectTag(sigT, 0x03, 'signatureValue');
  if (sigT.content[0] !== 0) fail('signature has unused bits');

  const f = children(der, tbsT);
  let i = 0;
  if (f[i]?.tag === 0xa0) {
    const v = children(der, f[i]);
    const version = expectTag(v[0], 0x02, 'version').content;
    if (version.length !== 1 || version[0] !== 2) fail('not an X.509 v3 certificate');
    i++;
  } else fail('not an X.509 v3 certificate');
  expectTag(f[i++], 0x02, 'serialNumber');
  const tbsSigAlg = algOid(der, f[i++]);
  if (tbsSigAlg !== sigAlg) fail('signature algorithm mismatch');
  const issuer = expectTag(f[i++], 0x30, 'issuer').full;
  const validity = children(der, expectTag(f[i++], 0x30, 'validity'));
  if (validity.length !== 2) fail('bad validity');
  const notBefore = decodeTime(validity[0]);
  const notAfter = decodeTime(validity[1]);
  const subject = expectTag(f[i++], 0x30, 'subject').full;
  const spkiT = expectTag(f[i++], 0x30, 'subjectPublicKeyInfo');
  const spkiParts = children(der, spkiT);
  const keyAlg = children(der, expectTag(spkiParts[0], 0x30, 'key algorithm'));
  if (decodeOid(expectTag(keyAlg[0], 0x06, 'key OID').content) !== OID_EC_PUBLIC_KEY) fail('not an EC key');
  const curve = decodeOid(expectTag(keyAlg[1], 0x06, 'curve OID').content);
  if (curve !== OID_P256 && curve !== OID_P384) fail('unsupported curve');

  let isCa = false;
  const extOids = new Set<string>();
  for (; i < f.length; i++) {
    if (f[i].tag === 0x81 || f[i].tag === 0x82) continue;   // unique ids
    if (f[i].tag !== 0xa3) fail('unexpected tbsCertificate field');
    const exts = children(der, expectTag(children(der, f[i])[0], 0x30, 'extensions'));
    for (const e of exts) {
      const parts = children(der, expectTag(e, 0x30, 'extension'));
      const oid = decodeOid(expectTag(parts[0], 0x06, 'extnID').content);
      if (extOids.has(oid)) fail('duplicate extension');
      extOids.add(oid);
      const value = expectTag(parts[parts.length - 1], 0x04, 'extnValue');
      if (oid === OID_BASIC_CONSTRAINTS) {
        const inner = readTlv(der, value.start, value.end);
        const bc = children(der, expectTag(inner, 0x30, 'basicConstraints'));
        if (bc[0]?.tag === 0x01) isCa = bc[0].content.length === 1 && bc[0].content[0] !== 0;
      }
    }
  }

  return {
    der, tbs: tbsT.full, sigAlg, signature: sigT.content.subarray(1), issuer, subject,
    notBefore, notAfter, spki: spkiT.full, curve, isCa, extOids,
  };
}

// DER ECDSA-Sig-Value -> r||s, each left-padded to the curve size.
function derSigToP1363(sig: Uint8Array, size: number): Uint8Array {
  const top = readTlv(sig, 0, sig.length);
  if (top.tag !== 0x30 || top.end !== sig.length) fail('bad ECDSA signature');
  const parts = children(sig, top);
  if (parts.length !== 2) fail('bad ECDSA signature');
  const out = new Uint8Array(size * 2);
  parts.forEach((p, k) => {
    expectTag(p, 0x02, 'ECDSA integer');
    let v = p.content;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) fail('bad ECDSA integer');
    out.set(v, k * size + (size - v.length));
  });
  return out;
}

const curveName = (oid: string) => (oid === OID_P256 ? 'P-256' : 'P-384');
const curveSize = (oid: string) => (oid === OID_P256 ? 32 : 48);

async function importKey(c: Cert): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'spki', buf(c.spki), { name: 'ECDSA', namedCurve: curveName(c.curve) }, false, ['verify'],
  );
}

// Does `issuer`'s key verify `subject`'s signature?
async function signedBy(subject: Cert, issuer: Cert): Promise<boolean> {
  let hash: string;
  if (subject.sigAlg === OID_ECDSA_SHA256) hash = 'SHA-256';
  else if (subject.sigAlg === OID_ECDSA_SHA384) hash = 'SHA-384';
  else return fail('unsupported certificate signature algorithm');
  const sig = derSigToP1363(subject.signature, curveSize(issuer.curve));
  return await crypto.subtle.verify(
    { name: 'ECDSA', hash }, await importKey(issuer), buf(sig), buf(subject.tbs),
  );
}

export type VerifyOptions = {
  now?: number;                 // ms; default Date.now()
  rootSha256?: string;          // tests only; default the pinned Apple root
};

// Verifies an Apple-signed JWS and returns its decoded payload.
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string, opts: VerifyOptions = {}): Promise<T> {
  if (typeof jws !== 'string' || jws.length > 64 * 1024) fail('bad JWS');
  const parts = jws.split('.');
  if (parts.length !== 3) fail('bad JWS');
  const [h64, p64, s64] = parts;

  let header: { alg?: unknown; x5c?: unknown; crit?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h64)));
  } catch {
    return fail('bad JWS header');
  }
  if (header.alg !== 'ES256') fail('alg must be ES256');
  if (header.crit !== undefined) fail('unsupported crit header');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === 'string' && c.length < 8192)) {
    fail('x5c must hold 3 certificates');
  }
  const [leaf, inter, root] = (x5c as string[]).map((c) => parseCert(b64ToBytes(c)));

  // 1. Trust anchor: the pinned Apple root, byte for byte.
  const rootHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf(root.der))));
  const want = (opts.rootSha256 ?? APPLE_ROOT_CA_G3_SHA256).toLowerCase();
  if (!bytesEqual(new TextEncoder().encode(rootHash), new TextEncoder().encode(want))) {
    fail('chain does not end in Apple Root CA - G3');
  }
  if (!bytesEqual(root.issuer, root.subject) || !(await signedBy(root, root))) fail('root not self-signed');

  // 2. Intermediate, issued by the root.
  if (!bytesEqual(inter.issuer, root.subject)) fail('intermediate not issued by root');
  if (!inter.isCa) fail('intermediate is not a CA');
  if (!inter.extOids.has(OID_APPLE_WWDR_INTERMEDIATE)) fail('intermediate lacks Apple marker');
  if (!(await signedBy(inter, root))) fail('intermediate signature invalid');

  // 3. Leaf, issued by the intermediate.
  if (!bytesEqual(leaf.issuer, inter.subject)) fail('leaf not issued by intermediate');
  if (leaf.isCa) fail('leaf is a CA');
  if (!leaf.extOids.has(OID_APPLE_RECEIPT_SIGNING)) fail('leaf lacks Apple marker');
  if (leaf.curve !== OID_P256) fail('leaf key is not P-256');
  if (!(await signedBy(leaf, inter))) fail('leaf signature invalid');

  // 4. Validity.
  const now = opts.now ?? Date.now();
  for (const c of [leaf, inter, root]) {
    if (now < c.notBefore || now > c.notAfter) fail('certificate outside its validity period');
  }

  // 5. The JWS itself.
  const sig = b64urlToBytes(s64);
  if (sig.length !== 64) fail('bad ES256 signature length');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, await importKey(leaf), buf(sig),
    buf(new TextEncoder().encode(h64 + '.' + p64)),
  );
  if (!ok) fail('JWS signature invalid');

  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(p64))) as T;
  } catch {
    return fail('bad JWS payload');
  }
}
