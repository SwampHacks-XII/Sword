// Wireless link to a physical sword through Web Bluetooth (Chrome/Edge on desktop, Chrome on Android).
// The firmware exposes the Nordic UART service: each notification on TX is one event line, and each
// write to RX is one command (no newline). The lines are the same as over USB; see serialSword.ts.
import type { SwordLink } from './serialSword';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // website -> sword
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // sword -> website

// Minimal typings: Web Bluetooth is not part of TypeScript's DOM library.
interface Characteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<Characteristic>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
}
interface GattServer {
  readonly connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }>;
}
interface Device extends EventTarget { readonly gatt?: GattServer }
interface BluetoothLike {
  requestDevice(options: { filters: { services?: string[]; namePrefix?: string }[]; optionalServices?: string[] }): Promise<Device>;
}
const bluetooth = () => (globalThis.navigator as { bluetooth?: BluetoothLike } | undefined)?.bluetooth;

export const bluetoothSupported = () => !!bluetooth();

/** Asks the player to pick their sword ("Sword1" / "Sword2") from nearby devices (needs a click). */
export async function openBluetoothSword(onLine: (line: string) => void, onClosed: () => void): Promise<SwordLink> {
  const api = bluetooth();
  if (!api) throw new Error('This browser cannot use Bluetooth swords. Use Chrome or Edge, and turn Bluetooth on.');
  const device = await api.requestDevice({ filters: [{ services: [SERVICE] }, { namePrefix: 'Sword' }], optionalServices: [SERVICE] });
  if (!device.gatt) throw new Error('That device does not support Bluetooth connections.');

  let rx: Characteristic;
  let tx: Characteristic;
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    [rx, tx] = await Promise.all([service.getCharacteristic(RX), service.getCharacteristic(TX)]);
  } catch {
    device.gatt.disconnect();
    throw new Error('Could not connect to the sword over Bluetooth. Make sure it is on and nearby, then try again.');
  }

  const decoder = new TextDecoder();
  const onValue = () => {
    if (!tx.value) return;
    for (const line of decoder.decode(tx.value).split('\n')) if (line) onLine(line);
  };
  let closing = false;
  const onDisconnected = () => {
    tx.removeEventListener('characteristicvaluechanged', onValue);
    device.removeEventListener('gattserverdisconnected', onDisconnected);
    if (!closing) onClosed();
  };
  tx.addEventListener('characteristicvaluechanged', onValue);
  device.addEventListener('gattserverdisconnected', onDisconnected);
  await tx.startNotifications();

  // Bluetooth allows one operation at a time, so writes go out in order, one after another.
  const encoder = new TextEncoder();
  let queue = Promise.resolve();
  return {
    write(line) {
      if (closing) return;
      const bytes = encoder.encode(line);
      queue = queue.then(() => (rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(bytes) : rx.writeValue(bytes))).catch(() => {});
    },
    async close() {
      if (closing) return;
      closing = true;
      await queue;
      device.gatt?.disconnect();
    },
  };
}
