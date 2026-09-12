/**
 * zip-read.mjs — a zip archive over a Buffer, read whole.
 *
 * The PitchBook and LCD downloads are Office files, and an Office file is
 * an ordinary zip: a pptx holds its slides, charts and chart caches as XML
 * members, an xlsx its sheets and shared strings. filing-parse.mjs's
 * unzipMember walks the same central directory but returns only the first
 * member matching a pattern, as a string; the ingest needs every member,
 * by name, as bytes (the EMF pictures are binary). This is the general
 * form. filing-parse.mjs is left as it is.
 *
 * Zero dependencies: node:zlib inflates the deflated members and stored
 * members are sliced out. The August 2026 monitor has 392 entries, 355
 * deflated and 37 stored (31 embedded workbooks, 5 PNGs, the thumbnail);
 * no zip64 records appear in any file the ingest reads, and a zip64
 * marker throws rather than misreading an oversized archive.
 *
 * writeZip builds an archive the same reader opens: the test fixtures are
 * cuts of the real deck and workbook rebuilt with it, so the test runs
 * the production path end to end, bytes to points.
 */
import { inflateRawSync, deflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const ZIP64_MARK = 0xffffffff;

/* ---------- reading ---------- */
export function readZip(buffer) {
  const B = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  /* The end-of-central-directory record sits in the last 64 KB plus its
     own 22 bytes; scan backwards for its signature. */
  let eocd = -1;
  for (let i = B.length - 22; i >= Math.max(0, B.length - 65558); i--) {
    if (B.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: no end-of-central-directory record");
  const count = B.readUInt16LE(eocd + 10);
  let off = B.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === ZIP64_MARK) throw new Error("zip: zip64 archive, not supported");

  const entries = [];
  const byName = new Map();
  for (let i = 0; i < count; i++) {
    if (off + 46 > B.length || B.readUInt32LE(off) !== SIG_CENTRAL) {
      throw new Error("zip: central directory entry " + i + " is not where the record says");
    }
    const method = B.readUInt16LE(off + 10);
    const crc = B.readUInt32LE(off + 16);
    const csize = B.readUInt32LE(off + 20);
    const size = B.readUInt32LE(off + 24);
    const nameLen = B.readUInt16LE(off + 28);
    const extraLen = B.readUInt16LE(off + 30);
    const commentLen = B.readUInt16LE(off + 32);
    const offset = B.readUInt32LE(off + 42);
    const name = B.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (csize === ZIP64_MARK || size === ZIP64_MARK || offset === ZIP64_MARK) {
      throw new Error("zip: zip64 sizes on " + name + ", not supported");
    }
    const entry = { name, method, size, csize, crc, offset };
    entries.push(entry);
    byName.set(name, entry);
    off += 46 + nameLen + extraLen + commentLen;
  }

  /* The local header repeats the name and may carry its own extra field,
     so the data start is computed from the local header, never from the
     central one. */
  const read = (name) => {
    const e = byName.get(name);
    if (!e) return null;
    const lho = e.offset;
    if (B.readUInt32LE(lho) !== SIG_LOCAL) throw new Error("zip: bad local header for " + name);
    const lNameLen = B.readUInt16LE(lho + 26);
    const lExtraLen = B.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const data = B.subarray(start, start + e.csize);
    if (e.method === 8) return inflateRawSync(data);
    if (e.method === 0) return Buffer.from(data);
    throw new Error("zip: compression method " + e.method + " on " + name + ", not supported");
  };

  return {
    entries,
    has: (name) => byName.has(name),
    read,
    text: (name) => { const b = read(name); return b === null ? null : b.toString("utf8"); },
    /* the names matching a pattern, in central-directory order */
    list: (regex) => entries.filter((e) => regex.test(e.name)).map((e) => e.name),
  };
}

/* ---------- writing ---------- */
/* CRC-32 is the only arithmetic a zip needs; the table form runs the
   fixture cut in a few milliseconds. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * writeZip(members, { deflate }) → Buffer
 *   members: [{ name, data: Buffer|string, deflate?: boolean }]
 * Every member is stored unless it, or the options, ask for deflate.
 * Dates are fixed (1980-01-01) so two builds of the same cut are
 * byte-identical.
 */
export function writeZip(members, options = {}) {
  const le16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const m of members) {
    const name = Buffer.from(m.name, "utf8");
    const data = Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data, "utf8");
    const deflate = m.deflate === undefined ? !!options.deflate : !!m.deflate;
    const stored = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    /* version needed 20, flags 0, DOS time and date 0/0x21 (1980-01-01) */
    const fixed = Buffer.concat([le16(20), le16(0), le16(method), le16(0), le16(0x21),
      le32(crc), le32(stored.length), le32(data.length), le16(name.length)]);
    locals.push(Buffer.concat([le32(SIG_LOCAL), fixed, le16(0), name, stored]));
    centrals.push(Buffer.concat([le32(SIG_CENTRAL), le16(20), fixed, le16(0), le16(0), le16(0), le16(0),
      le32(0), le32(offset), name]));
    offset += 30 + name.length + stored.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.concat([le32(SIG_EOCD), le16(0), le16(0), le16(members.length), le16(members.length),
    le32(dir.length), le32(offset), le16(0)]);
  return Buffer.concat([...locals, dir, eocd]);
}
