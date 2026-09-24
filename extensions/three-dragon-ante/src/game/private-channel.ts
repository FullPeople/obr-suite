/** Private seat messages over Owlbear's room-wide broadcast transport.
 * ECDH P-256 + HKDF SHA-256 + AES-GCM use the browser's native Web Crypto.
 * The caller authenticates peer keys with the SDK event.connectionId and
 * current room membership. This does not hide a deck from its host/dealer. */
export interface KeyHello { version: 1; keyId: string; publicKey: JsonWebKey }
export interface PrivateIdentity { hello: KeyHello; privateKey: CryptoKey }
export interface LinkContext { roomId: string; tableId: string; sessionId: string; localConnectionId: string; remoteConnectionId: string }
export interface PrivatePacket {
  kind: "private"; version: 1; tableId: string; from: string; to: string;
  fromKey: string; toKey: string; sessionId: string; messageId: string; sequence: number;
  iv: string; part: number; total: number; ciphertext: string;
}
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_PLAIN_BYTES = 65536, PART_CHARS = 10000, MAX_PARTS = 9, MAX_ASSEMBLIES = 8, MAX_DECRYPTIONS = 8, ASSEMBLY_TTL = 15000;
const b64 = (bytes: Uint8Array) => {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
};
const unb64 = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export async function createPrivateIdentity(): Promise<PrivateIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([publicKey.crv, publicKey.x, publicKey.y])));
  return { privateKey: pair.privateKey, hello: { version: 1, publicKey, keyId: b64(new Uint8Array(digest)) } };
}
function validHello(hello: KeyHello): boolean {
  const key = hello?.publicKey;
  return hello?.version === 1 && text(hello.keyId, 64) && key?.kty === "EC" && key.crv === "P-256" &&
    text(key.x, 64) && text(key.y, 64) && key.d === undefined;
}
interface Assembly { at: number; packet: PrivatePacket; parts: Map<number, string> }
export class PrivateLink {
  private outgoing = 0;
  private incoming = new Set<number>();
  private highSequence = 0;
  private processing = new Set<number>();
  private assemblies = new Map<string, Assembly>();
  private disposed = false;
  private constructor(private context: LinkContext, private own: KeyHello, private peer: KeyHello, private key: CryptoKey) {}

  static async create(context: LinkContext, own: PrivateIdentity, peer: KeyHello): Promise<PrivateLink> {
    if (!validHello(peer) || !validHello(own.hello) ||
        ![context?.roomId, context?.tableId, context?.sessionId, context?.localConnectionId, context?.remoteConnectionId].every(value => text(value)) ||
        context.localConnectionId === context.remoteConnectionId) throw Error("invalidPeer");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([peer.publicKey.crv, peer.publicKey.x, peer.publicKey.y])));
    if (b64(new Uint8Array(digest)) !== peer.keyId) throw Error("invalidPeer");
    const remoteKey = await crypto.subtle.importKey("jwk", peer.publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: remoteKey }, own.privateKey, 256);
    const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const endpoints = [[context.localConnectionId, own.hello.keyId], [context.remoteConnectionId, peer.keyId]].sort((a,b) => a[0].localeCompare(b[0]));
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
      salt: encoder.encode(JSON.stringify(["obr-suite/three-dragon-ante/v1", context.roomId, context.tableId, context.sessionId])),
      info: encoder.encode(JSON.stringify(endpoints)),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return new PrivateLink({ ...context }, structuredClone(own.hello), structuredClone(peer), key);
  }
  private aad(packet: PrivatePacket): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify([packet.version, this.context.roomId, packet.tableId, packet.from, packet.to,
      packet.fromKey, packet.toKey, packet.sessionId, packet.messageId, packet.sequence, packet.total]));
  }
  async seal(value: unknown): Promise<PrivatePacket[]> {
    if (this.disposed) throw Error("disposed");
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw Error("invalidPayload");
    const bytes = encoder.encode(serialized);
    if (bytes.length > MAX_PLAIN_BYTES) throw Error("payloadTooLarge");
    const sequence = ++this.outgoing;
    if (!Number.isSafeInteger(sequence)) throw Error("sequenceExhausted");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const total = Math.ceil((4 * Math.ceil((bytes.length + 16) / 3)) / PART_CHARS);
    const packet: PrivatePacket = { kind: "private", version: 1, tableId: this.context.tableId,
      from: this.context.localConnectionId, to: this.context.remoteConnectionId,
      fromKey: this.own.keyId, toKey: this.peer.keyId, sessionId: this.context.sessionId, messageId: crypto.randomUUID(), sequence,
      iv: b64(iv), part: 0, total, ciphertext: "" };
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad(packet), tagLength: 128 }, this.key, bytes);
    if (this.disposed) throw Error("disposed");
    const ciphertext = b64(new Uint8Array(encrypted));
    return Array.from({ length: total }, (_, part) => ({ ...packet, part, ciphertext: ciphertext.slice(part * PART_CHARS, (part + 1) * PART_CHARS) }));
  }
  /** Actual sender MUST come from the SDK event, never the packet's own from.
   * Incomplete, unauthenticated, duplicate and expired messages yield undefined. */
  async receive(value: unknown, actualSender: string, now = Date.now()): Promise<unknown | undefined> {
    if (this.disposed || !value || typeof value !== "object") return;
    const packet = value as PrivatePacket;
    if (actualSender !== this.context.remoteConnectionId || packet.from !== actualSender || packet.to !== this.context.localConnectionId ||
        packet.kind !== "private" || packet.version !== 1 || packet.tableId !== this.context.tableId || packet.sessionId !== this.context.sessionId ||
        packet.fromKey !== this.peer.keyId || packet.toKey !== this.own.keyId || !text(packet.messageId, 64) || !text(packet.iv, 24) ||
        !Number.isSafeInteger(packet.sequence) || packet.sequence < 1 || !Number.isInteger(packet.part) ||
        !Number.isInteger(packet.total) || packet.total < 1 || packet.total > MAX_PARTS || packet.part < 0 || packet.part >= packet.total ||
        !text(packet.ciphertext, PART_CHARS) || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.ciphertext)) return;
    if (packet.sequence <= this.highSequence - 64 || this.incoming.has(packet.sequence) || this.processing.has(packet.sequence)) return;
    if (this.processing.size >= MAX_DECRYPTIONS) return;
    for (const [id, assembly] of this.assemblies) if (now - assembly.at > ASSEMBLY_TTL) this.assemblies.delete(id);
    let assembly = this.assemblies.get(packet.messageId);
    if (!assembly) {
      if (this.assemblies.size >= MAX_ASSEMBLIES) this.assemblies.delete(this.assemblies.keys().next().value!);
      assembly = { at: now, packet: { ...packet }, parts: new Map() };
      this.assemblies.set(packet.messageId, assembly);
    }
    const first = assembly.packet;
    if (first.sequence !== packet.sequence || first.total !== packet.total || first.iv !== packet.iv ||
        (assembly.parts.has(packet.part) && assembly.parts.get(packet.part) !== packet.ciphertext)) {
      this.assemblies.delete(packet.messageId); return;
    }
    assembly.parts.set(packet.part, packet.ciphertext);
    if (assembly.parts.size !== packet.total) return;
    this.assemblies.delete(packet.messageId); this.processing.add(packet.sequence);
    try {
      const iv = unb64(packet.iv);
      if (iv.length !== 12) return;
      const ciphertext = unb64(Array.from({ length: packet.total }, (_, i) => assembly!.parts.get(i)).join(""));
      if (ciphertext.length > MAX_PLAIN_BYTES + 16) return;
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: this.aad(packet), tagLength: 128 }, this.key, ciphertext);
      if (this.disposed || packet.sequence <= this.highSequence - 64 || this.incoming.has(packet.sequence)) return;
      const payload: unknown = JSON.parse(decoder.decode(plain));
      this.highSequence = Math.max(this.highSequence, packet.sequence); this.incoming.add(packet.sequence);
      for (const sequence of this.incoming) if (sequence <= this.highSequence - 64) this.incoming.delete(sequence);
      return payload;
    } catch { return; }
    finally { this.processing.delete(packet.sequence); }
  }
  dispose(): void { this.disposed = true; this.assemblies.clear(); this.incoming.clear(); this.processing.clear(); }
}
