/**
 * happy-dom has no 2D canvas, so AntV G cannot draw. This installs a recording stand-in for
 * `CanvasRenderingContext2D` (every method a no-op, properties stored, `measureText` estimated)
 * so a real G6 `Graph` renders, animates and fires events in tests. Calls are counted per method.
 */

export interface CanvasMock {
  /** Method name → number of calls since install / reset. */
  readonly calls: Map<string, number>;
  /** Arguments of every `createRadialGradient` / `addColorStop` call. */
  readonly gradients: { stops: [number, string][] }[];
  reset(): void;
  restore(): void;
}

export function installCanvasMock(): CanvasMock {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (this: HTMLCanvasElement, kind: string) => unknown;
  };
  const original = proto.getContext;
  const calls = new Map<string, number>();
  const gradients: { stops: [number, string][] }[] = [];
  const count = (name: string): void => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
  };
  proto.getContext = function getContext(this: HTMLCanvasElement) {
    const fixed: Record<string | symbol, unknown> = {
      canvas: this,
      measureText: (text: string) => {
        count('measureText');
        const width = [...String(text)].length * 7;
        return {
          width,
          actualBoundingBoxAscent: 9,
          actualBoundingBoxDescent: 3,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
          fontBoundingBoxAscent: 10,
          fontBoundingBoxDescent: 3,
        };
      },
      createRadialGradient: () => {
        count('createRadialGradient');
        const g = { stops: [] as [number, string][] };
        gradients.push(g);
        return { addColorStop: (at: number, color: string) => g.stops.push([at, color]) };
      },
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => ({}),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      getLineDash: () => [],
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      isPointInPath: () => false,
      isPointInStroke: () => false,
    };
    return new Proxy(fixed, {
      get(target, key) {
        if (key in target) return target[key];
        return (..._args: unknown[]) => {
          count(String(key));
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
  };
  return {
    calls,
    gradients,
    reset() {
      calls.clear();
      gradients.length = 0;
    },
    restore() {
      proto.getContext = original;
    },
  };
}
