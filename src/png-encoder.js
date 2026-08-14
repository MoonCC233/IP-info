// 纯 JS PNG 编码器：使用 CompressionStream('deflate') 进行原生 DEFLATE 压缩
// CompressionStream 的压缩在运行时原生层完成，不计入 Worker JS CPU 时间，
// 因此可在免费版 10ms CPU 限制内完成 RGBA → PNG 编码。
// 滤镜使用 Up(2) 以获得更好的压缩比。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function concat(arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of arrs) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

function chunk(type, data) {
  const typeBytes = new Uint8Array(
    [...type].map((c) => c.charCodeAt(0))
  );
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = u32(crc32(crcInput, 0, crcInput.length));
  return concat([u32(data.length), typeBytes, data, crc]);
}

async function deflateZlib(data) {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const filtered = new Uint8Array((stride + 1) * h);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const off = y * (stride + 1);
    filtered[off] = 2; // Up filter
    const rowStart = y * stride;
    for (let i = 0; i < stride; i++) {
      const cur = rgba[rowStart + i];
      filtered[off + 1 + i] = (cur - prev[i]) & 0xff;
      prev[i] = cur;
    }
  }

  const idat = await deflateZlib(filtered);

  const ihdrData = new Uint8Array(13);
  ihdrData.set(u32(w), 0);
  ihdrData.set(u32(h), 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace: none

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([
    sig,
    chunk("IHDR", ihdrData),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
