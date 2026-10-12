export interface SignEditRequest {
  hanging: boolean;
  standing: boolean;
  texture: string; // block texture key of the board
  lines: string[];
  maxWidth: number;
  color: number;
  update(lines: string[]): void;
  done(lines: string[]): void;
}

let current: SignEditRequest | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

export const signEdit = {
  get: () => current,
  open(req: SignEditRequest) {
    current = req;
    notify();
  },
  close(lines?: string[]) {
    const req = current;
    current = null;
    if (req && lines) req.done(lines);
    notify();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
