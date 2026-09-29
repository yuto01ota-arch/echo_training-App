import { PACK_SIZE, IMAGE } from "../config.js";
export const MAX_PACK_BYTES = IMAGE.maxPackBytes;
export function packFrames(frames) {
  if (frames.length !== PACK_SIZE)
    throw new Error("画像の枚数が正しくありません。");
  const header = new Uint32Array(PACK_SIZE);
  frames.forEach((frame, i) => (header[i] = frame.size));
  // Explicit little-endian lengths, followed by the JPEG byte streams.
  const bytes = new Uint8Array(PACK_SIZE * Uint32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  header.forEach((size, i) =>
    view.setUint32(i * Uint32Array.BYTES_PER_ELEMENT, size, true),
  );
  return new Blob([bytes, ...frames], { type: "application/octet-stream" });
}
export function unpackFrames(buffer, packSize = PACK_SIZE) {
  if (
    !Number.isSafeInteger(packSize) || packSize < 1 ||
    buffer.byteLength <= packSize * Uint32Array.BYTES_PER_ELEMENT ||
    buffer.byteLength > MAX_PACK_BYTES
  )
    throw new Error("画像データのサイズが正しくありません。");
  const view = new DataView(buffer);
  const frames = [];
  let offset = packSize * Uint32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < packSize; i++) {
    const length = view.getUint32(i * Uint32Array.BYTES_PER_ELEMENT, true);
    if (
      length < 4 ||
      length > IMAGE.maxFrameBytes ||
      offset + length > buffer.byteLength
    )
      throw new Error("画像データが壊れています。");
    const frame = new Uint8Array(buffer, offset, length);
    if (
      frame[0] !== 255 ||
      frame[1] !== 216 ||
      frame[length - 2] !== 255 ||
      frame[length - 1] !== 217
    )
      throw new Error("JPEG画像を指定してください。");
    frames.push(frame);
    offset += length;
  }
  if (offset !== buffer.byteLength)
    throw new Error("画像データの長さが正しくありません。");
  return frames;
}
