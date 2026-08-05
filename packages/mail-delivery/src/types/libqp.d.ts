declare module "libqp" {
  export function encode(buffer: Buffer | string): string;
  export function decode(input: string): Buffer;
  export function wrap(str: string, lineLength?: number): string;
}
