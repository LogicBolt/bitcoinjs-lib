import {
  BufferReader,
  BufferWriter,
  reverseBuffer,
  varuint,
} from './bufferutils.js';
import * as bcrypto from './crypto.js';
import { fastMerkleRoot } from './merkle.js';
import { Transaction } from './transaction.js';
import * as v from 'valibot';
import * as tools from 'uint8array-tools';

// const { typeforce } = types;

const errorMerkleNoTxes = new TypeError(
  'Cannot compute merkle root for zero transactions',
);
const errorWitnessNotSegwit = new TypeError(
  'Cannot compute witness commit for non-segwit block',
);

export class Block {
  static fromBuffer(buffer: Uint8Array): Block {
    if (buffer.length < 80) throw new Error('Buffer too small (< 80 bytes)');

    const bufferReader = new BufferReader(buffer);

    const block = new Block();
    block.version = bufferReader.readInt32();
    block.prevHash = bufferReader.readSlice(32);
    block.merkleRoot = bufferReader.readSlice(32);
    block.timestamp = bufferReader.readUInt32();
    block.bits = bufferReader.readUInt32();
    block.nonce = bufferReader.readUInt32();

    if (buffer.length === 80) return block;

    const readTransaction = (): any => {
      const tx = Transaction.fromBuffer(
        bufferReader.buffer.slice(bufferReader.offset),
        true,
      );
      bufferReader.offset += tx.byteLength();
      return tx;
    };

    const nTransactions = bufferReader.readVarInt();
    block.transactions = [];

    for (let i = 0; i < nTransactions; ++i) {
      const tx = readTransaction();
      block.transactions.push(tx);
    }

    const witnessCommit = block.getWitnessCommit();
    // This Block contains a witness commit
    if (witnessCommit) block.witnessCommit = witnessCommit;

    return block;
  }

  static fromHex(hex: string): Block {
    // return Block.fromBuffer(Buffer.from(hex, 'hex'));
    return Block.fromBuffer(tools.fromHex(hex));
  }

  static calculateTarget(bits: number): Uint8Array {
    const exponent = ((bits & 0xff000000) >> 24) - 3;
    const mantissa = bits & 0x007fffff;
    const target = new Uint8Array(32);
    // target.writeUIntBE(mantissa, 29 - exponent, 3);
    target[29 - exponent] = (mantissa >> 16) & 0xff;
    target[30 - exponent] = (mantissa >> 8) & 0xff;
    target[31 - exponent] = mantissa & 0xff;
    return target;
  }

  static calculateMerkleRoot(
    transactions: Transaction[],
    forWitness?: boolean,
  ): Uint8Array {
    // typeforce([{ getHash: types.Function }], transactions);
    v.parse(v.array(v.object({ getHash: v.function() })), transactions);
    if (transactions.length === 0) throw errorMerkleNoTxes;
    if (forWitness && !txesHaveWitnessCommit(transactions))
      throw errorWitnessNotSegwit;

    const hashes = transactions.map(transaction =>
      transaction.getHash(forWitness!),
    );

    const rootHash = fastMerkleRoot(hashes, bcrypto.hash256);

    return forWitness
      ? bcrypto.hash256(
          tools.concat([rootHash, transactions[0].ins[0].witness[0]]),
        )
      : rootHash;
  }

  version: number = 1;
  prevHash?: Uint8Array = undefined;
  merkleRoot?: Uint8Array = undefined;
  timestamp: number = 0;
  witnessCommit?: Uint8Array = undefined;
  bits: number = 0;
  nonce: number = 0;
  transactions?: Transaction[] = undefined;

  getWitnessCommit(): Uint8Array | null {
    if (!txesHaveWitnessCommit(this.transactions!)) return null;

    // The merkle root for the witness data is in an OP_RETURN output.
    // There is no rule for the index of the output, so use filter to find it.
    // The root is prepended with 0xaa21a9ed so check for 0x6a24aa21a9ed
    // If multiple commits are found, the output with highest index is assumed.
    const witnessCommits = this.transactions![0].outs.filter(
      out =>
        // out.script.slice(0, 6).equals(Buffer.from('6a24aa21a9ed', 'hex')),
        tools.compare(
          out.script.slice(0, 6),
          Uint8Array.from([0x6a, 0x24, 0xaa, 0x21, 0xa9, 0xed]),
        ) === 0,
    ).map(out => out.script.slice(6, 38));
    if (witnessCommits.length === 0) return null;
    // Use the commit with the highest output (should only be one though)
    const result = witnessCommits[witnessCommits.length - 1];

    if (!(result instanceof Uint8Array && result.length === 32)) return null;
    return result;
  }

  hasWitnessCommit(): boolean {
    if (
      this.witnessCommit instanceof Uint8Array &&
      this.witnessCommit.length === 32
    )
      return true;
    if (this.getWitnessCommit() !== null) return true;
    return false;
  }

  hasWitness(): boolean {
    return anyTxHasWitness(this.transactions!);
  }

  weight(): number {
    const base = this.byteLength(false, false);
    const total = this.byteLength(false, true);
    return base * 3 + total;
  }

  byteLength(headersOnly?: boolean, allowWitness: boolean = true): number {
    if (headersOnly || !this.transactions) return 80;

    return (
      80 +
      varuint.encodingLength(this.transactions.length) +
      this.transactions.reduce((a, x) => a + x.byteLength(allowWitness), 0)
    );
  }

  getHash(): Uint8Array {
    return bcrypto.hash256(this.toBuffer(true));
  }

  getId(): string {
    return tools.toHex(reverseBuffer(this.getHash()));
  }

  getUTCDate(): Date {
    const date = new Date(0); // epoch
    date.setUTCSeconds(this.timestamp);

    return date;
  }

  // TODO: buffer, offset compatibility
  toBuffer(headersOnly?: boolean): Uint8Array {
    const buffer = new Uint8Array(this.byteLength(headersOnly));

    const bufferWriter = new BufferWriter(buffer);

    bufferWriter.writeInt32(this.version);
    bufferWriter.writeSlice(this.prevHash!);
    bufferWriter.writeSlice(this.merkleRoot!);
    bufferWriter.writeUInt32(this.timestamp);
    bufferWriter.writeUInt32(this.bits);
    bufferWriter.writeUInt32(this.nonce);

    if (headersOnly || !this.transactions) return buffer;

    const { bytes } = varuint.encode(
      this.transactions.length,
      buffer,
      bufferWriter.offset,
    );
    bufferWriter.offset += bytes;

    this.transactions.forEach(tx => {
      const txSize = tx.byteLength(); // TODO: extract from toBuffer?
      tx.toBuffer(buffer, bufferWriter.offset);
      bufferWriter.offset += txSize;
    });

    return buffer;
  }

  toHex(headersOnly?: boolean): string {
    return tools.toHex(this.toBuffer(headersOnly));
  }

  checkTxRoots(): boolean {
    // If the Block has segwit transactions but no witness commit,
    // there's no way it can be valid, so fail the check.
    const hasWitnessCommit = this.hasWitnessCommit();
    if (!hasWitnessCommit && this.hasWitness()) return false;
    return (
      this.__checkMerkleRoot() &&
      (hasWitnessCommit ? this.__checkWitnessCommit() : true)
    );
  }

  checkProofOfWork(): boolean {
    const hash = reverseBuffer(this.getHash());
    const target = Block.calculateTarget(this.bits);

    // return hash.compare(target) <= 0;
    return tools.compare(hash, target) <= 0;
  }

  private __checkMerkleRoot(): boolean {
    if (!this.transactions) throw errorMerkleNoTxes;

    const actualMerkleRoot = Block.calculateMerkleRoot(this.transactions);
    // return this.merkleRoot!.compare(actualMerkleRoot) === 0;
    return tools.compare(this.merkleRoot!, actualMerkleRoot) === 0;
  }

  private __checkWitnessCommit(): boolean {
    if (!this.transactions) throw errorMerkleNoTxes;
    if (!this.hasWitnessCommit()) throw errorWitnessNotSegwit;

    const actualWitnessCommit = Block.calculateMerkleRoot(
      this.transactions,
      true,
    );
    // return this.witnessCommit!.compare(actualWitnessCommit) === 0;
    return tools.compare(this.witnessCommit!, actualWitnessCommit) === 0;
  }
}

function txesHaveWitnessCommit(transactions: Transaction[]): boolean {
  return (
    transactions instanceof Array &&
    transactions[0] &&
    transactions[0].ins &&
    transactions[0].ins instanceof Array &&
    transactions[0].ins[0] &&
    transactions[0].ins[0].witness &&
    transactions[0].ins[0].witness instanceof Array &&
    transactions[0].ins[0].witness.length > 0
  );
}

function anyTxHasWitness(transactions: Transaction[]): boolean {
  return (
    transactions instanceof Array &&
    transactions.some(
      tx =>
        typeof tx === 'object' &&
        tx.ins instanceof Array &&
        tx.ins.some(
          input =>
            typeof input === 'object' &&
            input.witness instanceof Array &&
            input.witness.length > 0,
        ),
    )
  );
}
