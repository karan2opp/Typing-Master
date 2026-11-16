/**
 * Whether someone is in the middle of a test, so the app does not log them out under their fingers,
 * and a signal each time a test starts or ends so their login can start its time over.
 * Plain module state: there is only ever one typing area on screen.
 */
let running = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};

export const testActivity = {
  /** A test began. Returns the function to call when it ends (safe to call more than once). */
  start(): () => void {
    running++;
    notify();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      running--;
      notify();
    };
  },
  isRunning: () => running > 0,
  /** Calls `fn` every time a test starts, and every time one ends (finished or abandoned). Returns the unsubscribe function. */
  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
