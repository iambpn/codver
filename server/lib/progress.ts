const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export { RESET, BOLD, RED, GREEN, YELLOW, CYAN, DIM };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Spinner state is encapsulated to prevent concurrent corruption.
// Only one spinner should be active at a time (enforced by spinningStep).
const _spinnerState = {
  interval: null as ReturnType<typeof setInterval> | null,
  prefix: "",
};

function startSpinner(prefix: string) {
  stopSpinner();
  _spinnerState.prefix = prefix;
  let frameIndex = 0;
  process.stdout.write("\x1b[?25l"); // hide cursor
  _spinnerState.interval = setInterval(() => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stdout.write(`\r${CYAN}${frame}${RESET} ${BOLD}${_spinnerState.prefix}${RESET}...`);
    frameIndex++;
  }, 80);
}

function stopSpinner() {
  if (_spinnerState.interval !== null) {
    clearInterval(_spinnerState.interval);
    _spinnerState.interval = null;
    process.stdout.write("\r" + " ".repeat(_spinnerState.prefix.length + 10) + "\r");
    process.stdout.write("\x1b[?25h"); // show cursor
  }
}

export async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`${CYAN}▸${RESET} ${BOLD}${label}${RESET}\n`);
  try {
    const result = await fn();
    process.stdout.write(`  ${GREEN}✓${RESET} ${DIM}${label}${RESET}\n\n`);
    return result;
  } catch (error) {
    process.stdout.write(`  ${RED}✗${RESET} ${label}\n`);
    if (error instanceof Error) {
      process.stdout.write(`  ${RED}  Error: ${error.message}${RESET}\n\n`);
    } else {
      process.stdout.write(`  ${RED}  Error: ${String(error)}${RESET}\n\n`);
    }
    throw error;
  }
}

export async function spinningStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  startSpinner(label);
  try {
    const result = await fn();
    stopSpinner();
    process.stdout.write(`${GREEN}✓${RESET} ${label}\n\n`);
    return result;
  } catch (error) {
    stopSpinner();
    process.stdout.write(`${RED}✗${RESET} ${label}\n`);
    if (error instanceof Error) {
      process.stdout.write(`  ${RED}Error: ${error.message}${RESET}\n\n`);
    } else {
      process.stdout.write(`  ${RED}Error: ${String(error)}${RESET}\n\n`);
    }
    throw error;
  }
}

export function info(message: string) {
  process.stdout.write(`  ${DIM}→${RESET} ${message}\n`);
}

export function success(message: string) {
  process.stdout.write(`  ${GREEN}✓${RESET} ${message}\n`);
}

export function warn(message: string) {
  process.stdout.write(`  ${YELLOW}⚠${RESET} ${message}\n`);
}

export function error(message: string) {
  process.stdout.write(`  ${RED}✗${RESET} ${message}\n`);
}

export function heading(message: string) {
  process.stdout.write(`\n${BOLD}${CYAN}═══ ${message} ═══${RESET}\n\n`);
}

export function substep(message: string) {
  process.stdout.write(`    ${DIM}‣${RESET} ${message}\n`);
}

export function blankLine() {
  process.stdout.write("\n");
}