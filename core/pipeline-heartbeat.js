const HEARTBEAT_INTERVAL = 500;
const STALL_THRESHOLD = 3000;

export function createHeartbeat(label, onStall) {
  let current = 'IDLE';
  let lastProgressAt = Date.now();
  let intervalId = null;
  let stalled = false;

  function monitor() {
    const elapsed = Date.now() - lastProgressAt;
    if (elapsed > STALL_THRESHOLD && !stalled) {
      stalled = true;
      if (onStall) onStall(current, elapsed);
    }
  }

  return {
    get current() { return current; },
    get isStalled() { return stalled; },
    get stallMs() { return Date.now() - lastProgressAt; },

    start() {
      current = 'STARTED';
      lastProgressAt = Date.now();
      stalled = false;
      intervalId = setInterval(monitor, HEARTBEAT_INTERVAL);
    },

    stop() {
      current = 'STOPPED';
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    },

    update(val) {
      current = val;
      lastProgressAt = Date.now();
      stalled = false;
    },
  };
}
