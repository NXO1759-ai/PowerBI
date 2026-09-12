/**
 * zip-stream.mjs — a zip reader for archives too large to hold in memory,
 * and the paced download that puts them on disk.
 *
 * filing-parse.mjs's unzipMember takes a Buffer and inflates one member
 * whole, which is right for a 1 MB -xbrl.zip and wrong for the SEC's
 * monthly BDC data set: 2026_08_bdc.zip is 265.6 MB on the wire and its
 * datasets/num.tsv inflates to 1.17 GB (probed 2026-09-11 from the
 * archive's own central directory). Nothing here reads a member into a
 * Buffer: the central directory is read from the tail of the file, a
 * member is served as a stream over its byte range through
 * node:zlib's inflateRaw, and a caller walks it line by line.
 *
 * ZIP64: the August archive does not need it (every size is below
 * 4 GB and the end-of-central-directory record carries no ZIP64
 * locator), but a wave that pushes num.tsv past 4 GB inflated would set
 * the size fields to 0xFFFFFFFF and move the real values into the ZIP64
 * extra field, so both the locator and the extra field are read.
 *
 * Downloads: one request at a time through the same pacing gate and
 * User-Agent as every other call to sec.gov (sec-pull.mjs), streamed to
 * a .part file and renamed when complete, never resumed, and skipped
 * when a HEAD says the remote is the file already on disk. SEC's files
 * host sends Content-Length and Last-Modified but no ETag (probed
 * 2026-09-11), so the sidecar keys on all three and treats a missing
 * header as "unknown", never as "changed".
 *
 * Zero dependencies.
 */

import { open, stat, rename, unlink, readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createInflateRaw, deflateRawSync } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";
import { SEC_UA, paced } from "./sec-pull.mjs";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65535;
const FOUR_GB_MARK = 0xffffffff;
const ZIP64_EXTRA_ID = 0x0001;

/* ---------- reading ---------- */

/**
 * The archive's table of contents, read from its tail: { path, size,
 * zip64, entries: [{ name, method, crc, csize, usize, localOffset }] }.
 * method is 8 (deflate) or 0 (stored) for every member the SEC ships;
 * anything else is reported as-is and refused by streamMember.
 */
export async function readCentralDirectory(path) {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, EOCD_MIN + MAX_COMMENT);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - EOCD_MIN; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`not a zip archive (no end-of-central-directory record): ${path}`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    let zip64 = false;
    if (count === 0xffff || cdSize === FOUR_GB_MARK || cdOffset === FOUR_GB_MARK) {
      const locAt = eocd - 20;
      if (locAt < 0 || tail.readUInt32LE(locAt) !== SIG_EOCD64_LOCATOR) {
        throw new Error(`zip64 markers without a zip64 locator: ${path}`);
      }
      const recAt = Number(tail.readBigUInt64LE(locAt + 8));
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, recAt);
      if (rec.readUInt32LE(0) !== SIG_EOCD64) throw new Error(`bad zip64 end-of-central-directory record: ${path}`);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
      zip64 = true;
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new Error(`central directory entry ${i} is not where the record says: ${path}`);
      }
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      if (usize === FOUR_GB_MARK || csize === FOUR_GB_MARK || localOffset === FOUR_GB_MARK) {
        /* the ZIP64 extra field carries, in this order, only the fields
           whose 32-bit slot is saturated */
        const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        let q = 0;
        while (q + 4 <= extra.length) {
          const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2);
          if (id === ZIP64_EXTRA_ID) {
            let r = q + 4;
            if (usize === FOUR_GB_MARK) { usize = Number(extra.readBigUInt64LE(r)); r += 8; }
            if (csize === FOUR_GB_MARK) { csize = Number(extra.readBigUInt64LE(r)); r += 8; }
            if (localOffset === FOUR_GB_MARK) { localOffset = Number(extra.readBigUInt64LE(r)); r += 8; }
            zip64 = true;
            break;
          }
          q += 4 + len;
        }
      }
      entries.push({ name, method, crc, csize, usize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { path, size, zip64, entries };
  } finally {
    await fh.close();
  }
}

/** The entry whose name equals `name`, or matches it when it is a RegExp. */
export function findEntry(directory, name) {
  const test = name instanceof RegExp ? (n) => name.test(n) : (n) => n === name;
  return directory.entries.find((e) => test(e.name)) || null;
}

/**
 * One member as a readable stream of its inflated bytes. The local
 * header is read for its own name and extra lengths — they can differ
 * from the central directory's — and the data is served from a byte
 * range, so a 1 GB member costs the same memory as a 1 KB one. Pass
 * `directory` to avoid re-reading the table of contents per member.
 */
export async function streamMember(path, name, { directory } = {}) {
  const dir = directory || await readCentralDirectory(path);
  const entry = findEntry(dir, name);
  if (!entry) throw new Error(`no member ${name} in ${path}`);
  if (entry.method !== 8 && entry.method !== 0) {
    throw new Error(`member ${entry.name} uses compression method ${entry.method}; only deflate (8) and stored (0) are read`);
  }
  const fh = await open(path, "r");
  let dataStart;
  try {
    const local = Buffer.alloc(30);
    await fh.read(local, 0, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`member ${entry.name}: local header not at offset ${entry.localOffset}`);
    dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  let raw;
  if (entry.csize === 0) {
    raw = Readable.from([]);
  } else {
    raw = createReadStream(path, { start: dataStart, end: dataStart + entry.csize - 1 });
  }
  const out = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  /* an error on the file stream must surface on the stream the caller holds */
  if (out !== raw) raw.on("error", (err) => out.destroy(err));
  out.entry = entry;
  return out;
}

/**
 * Walk a byte stream line by line: UTF-8 decoded across chunk
 * boundaries, split on "\n", a trailing "\r" removed, and the last
 * line delivered even when the file does not end in a newline. onLine
 * receives (line, index) and may return false to stop early. Resolves
 * to the number of lines delivered.
 */
export async function readLines(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  let index = 0;
  let stopped = false;
  const deliver = (line) => {
    if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    const r = onLine(line, index++);
    if (r === false) { stopped = true; return false; }
    return true;
  };
  for await (const chunk of stream) {
    rest += decoder.write(chunk);
    let from = 0, nl;
    while ((nl = rest.indexOf("\n", from)) !== -1) {
      if (!deliver(rest.slice(from, nl))) break;
      from = nl + 1;
    }
    rest = rest.slice(from);
    if (stopped) { stream.destroy(); break; }
  }
  if (!stopped) {
    rest += decoder.end();
    if (rest.length) deliver(rest);
  }
  return index;
}

/* ---------- downloading ---------- */

const sidecarPath = (dest) => dest + ".meta.json";

async function readJsonIfExists(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function sizeIfExists(path) {
  try { return (await stat(path)).size; } catch { return null; }
}

/**
 * Stream `url` to `dest` with the SEC User-Agent, one request at a time
 * through the shared pacing gate. A HEAD first: when Content-Length,
 * ETag and Last-Modified all agree with the sidecar written by the last
 * download (dest + ".meta.json", or the object passed as ifChangedFrom)
 * and the file on disk has that length, nothing is fetched. A header the
 * server does not send is not compared. There is no resume: a partial
 * download is a .part file that the next run overwrites.
 *
 * Returns { path, skipped, bytes, contentLength, etag, lastModified,
 * sidecar }. Throws on a non-2xx GET after `retries` attempts.
 */
export async function downloadToFile(url, dest, { headers, ifChangedFrom, retries = 2, timeoutMs = 600000 } = {}) {
  const h = { ...SEC_UA, ...(headers || {}) };
  const meta = sidecarPath(dest);
  const prior = ifChangedFrom === undefined ? await readJsonIfExists(meta) : ifChangedFrom;

  await paced();
  let head = null;
  try {
    const r = await fetch(url, { method: "HEAD", headers: h });
    if (r.ok) {
      head = {
        /* a Content-Length on a gzip-encoded reply is the wire length,
           not the file's: unknown for the comparison below */
        contentLength: r.headers.get("content-length") && !r.headers.get("content-encoding") ? Number(r.headers.get("content-length")) : null,
        etag: r.headers.get("etag"),
        lastModified: r.headers.get("last-modified"),
      };
    }
  } catch {
    head = null;
  }
  if (head && prior) {
    const same = (k) => head[k] == null || prior[k] == null || head[k] === prior[k];
    const onDisk = await sizeIfExists(dest);
    if (same("contentLength") && same("etag") && same("lastModified") &&
        onDisk !== null && (head.contentLength === null || onDisk === head.contentLength)) {
      return { path: dest, skipped: true, bytes: onDisk, ...head, sidecar: meta };
    }
  }

  await mkdir(dirname(dest), { recursive: true });
  const part = dest + ".part";
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paced();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers: h, signal: ctrl.signal });
      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`${resp.status} from ${url}`);
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!resp.ok) throw new Error(`${resp.status} from ${url}`);
      /* fetch inflates a gzip-encoded reply (www.sec.gov sends
         FilingSummary.xml and the R pages that way; the zips not), so
         the wire length is not the file's and is not compared */
      const encoded = !!resp.headers.get("content-encoding");
      const got = {
        contentLength: resp.headers.get("content-length") && !encoded ? Number(resp.headers.get("content-length")) : null,
        etag: resp.headers.get("etag"),
        lastModified: resp.headers.get("last-modified"),
      };
      await pipeline(Readable.fromWeb(resp.body), createWriteStream(part));
      const bytes = (await stat(part)).size;
      if (got.contentLength !== null && bytes !== got.contentLength) {
        throw new Error(`short download: ${bytes} of ${got.contentLength} bytes from ${url}`);
      }
      await rename(part, dest);
      const record = { url, ...got, bytes, downloadedAt: new Date().toISOString() };
      await writeFile(meta, JSON.stringify(record, null, 2) + "\n");
      return { path: dest, skipped: false, bytes, ...got, sidecar: meta };
    } catch (err) {
      lastError = err;
      await unlink(part).catch(() => {});
      if (err && err.name === "AbortError") continue;
      if (/^(429|5\d\d) from/.test(String(err && err.message))) continue;
      if (/short download/.test(String(err && err.message))) continue;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`download failed: ${url}`);
}

/* ---------- writing (tests and small caches) ---------- */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * Write a zip from in-memory members — the test suite's way of turning
 * TSV fixtures into the archive shape the readers expect. members:
 * [{ name, data: Buffer | string, method?: 8 | 0 }]. With zip64: true the
 * central directory and end record are written in ZIP64 form (saturated
 * 32-bit fields plus the extra field, record and locator) so the reader's
 * ZIP64 branch can be exercised on a small file. Node 20's zlib has no
 * crc32, hence the table above.
 */
export async function writeZipFile(path, members, { zip64 = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const m of members) {
    const data = Buffer.isBuffer(m.data) ? m.data : Buffer.from(String(m.data), "utf8");
    const method = m.method === 0 ? 0 : 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(m.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(0x0800, 6);           /* UTF-8 names */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const extra = zip64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(ZIP64_EXTRA_ID, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(packed.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(zip64 ? 45 : 20, 4);
    central.writeUInt16LE(zip64 ? 45 : 20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(zip64 ? FOUR_GB_MARK : packed.length, 20);
    central.writeUInt32LE(zip64 ? FOUR_GB_MARK : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(zip64 ? FOUR_GB_MARK : offset, 42);
    centrals.push(central, name, extra);
    offset += local.length + name.length + packed.length;
  }
  const cdOffset = offset;
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const tail = [];
  if (zip64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(SIG_EOCD64, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
    rec.writeUInt32LE(0, 16); rec.writeUInt32LE(0, 20);
    rec.writeBigUInt64LE(BigInt(members.length), 24);
    rec.writeBigUInt64LE(BigInt(members.length), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(SIG_EOCD64_LOCATOR, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    tail.push(rec, loc);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(zip64 ? 0xffff : members.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : members.length, 10);
  eocd.writeUInt32LE(zip64 ? FOUR_GB_MARK : cdSize, 12);
  eocd.writeUInt32LE(zip64 ? FOUR_GB_MARK : cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  tail.push(eocd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.concat([...locals, ...centrals, ...tail]));
  return { path, members: members.length, zip64 };
}
