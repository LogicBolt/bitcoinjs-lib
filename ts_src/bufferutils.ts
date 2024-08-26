import * as types from './types.js';
import * as varuint from 'varuint-bitcoin';
import * as v from 'valibot';
export { varuint };
import * as tools from 'uint8array-tools';

const MAX_JS_NUMBER = 0x001fffffffffffff;

// https://github.com/feross/buffer/blob/master/index.js#L1127
function verifuint(value: number | bigint, max: number): void {
  if (typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error('cannot write a non-number as a number');
  if (value < 0 && value < BigInt(0))
    throw new Error('specified a negative value for writing an unsigned value');
  if (value > max && value > BigInt(max))
    throw new Error('RangeError: value out of range');
  if (Math.floor(Number(value)) !== Number(value))
    throw new Error('value has a fractional component');
}

// export function readUInt64LE(buffer: Buffer, offset: number): number {
//   const a = buffer.readUInt32LE(offset);
//   let b = buffer.readUInt32LE(offset + 4);
//   b *= 0x100000000;

//   verifuint(b + a, MAX_JS_NUMBER);
//   return b + a;
// }

/**
 * Writes a 64-bit unsigned integer in little-endian format to the specified buffer at the given offset.
 *
 * @param buffer - The buffer to write the value to.
 * @param value - The 64-bit unsigned integer value to write.
 * @param offset - The offset in the buffer where the value should be written.
 * @returns The new offset after writing the value.
 */
// export function writeUInt64LE(
//   buffer: Buffer,
//   value: number,
//   offset: number,
// ): number {
//   verifuint(value, MAX_JS_NUMBER);

//   buffer.writeInt32LE(value & -1, offset);
//   buffer.writeUInt32LE(Math.floor(value / 0x100000000), offset + 4);
//   return offset + 8;
// }

/**
 * Reads a 64-bit signed integer from a Uint8Array in little-endian format.
 *
 * @param {Uint8Array} buffer - The buffer to read the value from.
 * @param {number} offset - The offset in the buffer where the value starts.
 * @return {number} The 64-bit signed integer value.
 */
// export function readInt64LE(
//   buffer: Uint8Array,
//   offset: number
// ): number {
//   if((buffer[offset + 7] & 0x7f) > 0) throw new Error("RangeError: value out of range, greater than int64");

//   return (
//     buffer[offset] |
//     (buffer[offset + 1] << 8) |
//     (buffer[offset + 2] << 16) |
//     (buffer[offset + 3] << 24) |
//     (buffer[offset + 4] << 32) |
//     (buffer[offset + 5] << 40) |
//     (buffer[offset + 6] << 48) |
//     (buffer[offset + 7] << 56)
//   );
// }

/**
 * Reverses the order of bytes in a buffer.
 * @param buffer - The buffer to reverse.
 * @returns A new buffer with the bytes reversed.
 */
export function reverseBuffer(buffer: Uint8Array): Uint8Array {
  if (buffer.length < 1) return buffer;
  let j = buffer.length - 1;
  let tmp = 0;
  for (let i = 0; i < buffer.length / 2; i++) {
    tmp = buffer[i];
    buffer[i] = buffer[j];
    buffer[j] = tmp;
    j--;
  }
  return buffer;
}

export function cloneBuffer(buffer: Uint8Array): Uint8Array {
  const clone = new Uint8Array(buffer.length);
  clone.set(buffer);
  return clone;
}

/**
 * Helper class for serialization of bitcoin data types into a pre-allocated buffer.
 */
export class BufferWriter {
  static withCapacity(size: number): BufferWriter {
    return new BufferWriter(new Uint8Array(size));
  }

  constructor(
    public buffer: Uint8Array,
    public offset: number = 0,
  ) {
    // typeforce(types.tuple(types.Buffer, types.UInt32), [buffer, offset]);
    v.parse(v.tuple([types.BufferSchema, types.UInt32Schema]), [
      buffer,
      offset,
    ]);
  }

  writeUInt8(i: number): void {
    // this.offset = this.buffer.writeUInt8(i, this.offset);
    this.offset = tools.writeUInt8(this.buffer, this.offset, i);
  }

  writeInt32(i: number): void {
    // this.offset = this.buffer.writeInt32LE(i, this.offset);
    this.offset = tools.writeInt32(this.buffer, i, this.offset, 'LE');
  }

  writeInt64(i: number | bigint): void {
    this.offset = tools.writeInt64(this.buffer, BigInt(i), this.offset, 'LE');
  }

  writeUInt32(i: number): void {
    // this.offset = this.buffer.writeUInt32LE(i, this.offset);
    this.offset = tools.writeUInt32(this.buffer, this.offset, i, 'LE');
  }

  writeUInt64(i: number | bigint): void {
    // this.offset = writeUInt64LE(this.buffer, i, this.offset);
    this.offset = tools.writeUInt64(this.buffer, this.offset, BigInt(i), 'LE');
  }

  writeVarInt(i: number): void {
    const { bytes } = varuint.encode(i, this.buffer, this.offset);
    this.offset += bytes;
  }

  writeSlice(slice: Uint8Array): void {
    if (this.buffer.length < this.offset + slice.length) {
      throw new Error('Cannot write slice out of bounds');
    }
    // this.offset += slice.copy(this.buffer, this.offset);
    this.buffer.set(slice, this.offset);
    this.offset += slice.length;
  }

  writeVarSlice(slice: Uint8Array): void {
    this.writeVarInt(slice.length);
    this.writeSlice(slice);
  }

  writeVector(vector: Uint8Array[]): void {
    this.writeVarInt(vector.length);
    vector.forEach((buf: Uint8Array) => this.writeVarSlice(buf));
  }

  end(): Uint8Array {
    if (this.buffer.length === this.offset) {
      return this.buffer;
    }
    throw new Error(`buffer size ${this.buffer.length}, offset ${this.offset}`);
  }
}

/**
 * Helper class for reading of bitcoin data types from a buffer.
 */
export class BufferReader {
  constructor(
    public buffer: Uint8Array,
    public offset: number = 0,
  ) {
    // typeforce(types.tuple(types.Buffer, types.UInt32), [buffer, offset]);
    v.parse(v.tuple([types.BufferSchema, types.UInt32Schema]), [
      buffer,
      offset,
    ]);
  }

  readUInt8(): number {
    // const result = this.buffer.readUInt8(this.offset);
    const result = tools.readUInt8(this.buffer, this.offset);
    this.offset++;
    return result;
  }

  readInt32(): number {
    // const result = readInt32LE(this.buffer, this.offset);
    const result = tools.readInt32(this.buffer, this.offset, 'LE');
    this.offset += 4;
    return result;
  }

  readUInt32(): number {
    // const result = this.buffer.readUInt32LE(this.offset);
    const result = tools.readUInt32(this.buffer, this.offset, 'LE');
    this.offset += 4;
    return result;
  }

  readUInt64(): bigint {
    // const result = readUInt64LE(this.buffer, this.offset);
    const result = tools.readUInt64(this.buffer, this.offset, 'LE');
    this.offset += 8;
    return result;
  }

  readVarInt(): bigint {
    const { bigintValue, bytes } = varuint.decode(this.buffer, this.offset);
    this.offset += bytes;
    return bigintValue;
  }

  readSlice(n: number | bigint): Uint8Array {
    verifuint(n, MAX_JS_NUMBER);
    const num = Number(n);
    if (this.buffer.length < this.offset + num) {
      throw new Error('Cannot read slice out of bounds');
    }
    const result = this.buffer.slice(this.offset, this.offset + num);
    this.offset += num;
    return result;
  }

  readVarSlice(): Uint8Array {
    return this.readSlice(this.readVarInt());
  }

  readVector(): Uint8Array[] {
    const count = this.readVarInt();
    const vector: Uint8Array[] = [];
    for (let i = 0; i < count; i++) vector.push(this.readVarSlice());
    return vector;
  }
}
