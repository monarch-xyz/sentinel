export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (bindings: { name?: string }) => Logger;
}

function withPrefix(prefix: string | undefined, args: unknown[]): unknown[] {
  if (!prefix) return args;
  return [prefix, ...args];
}

export function createLogger(name?: string | { name?: string }): Logger {
  const resolvedName = typeof name === 'string' ? name : name?.name;
  const prefix = resolvedName ? `[${resolvedName}]` : undefined;

  return {
    info: (...args) => console.log(...withPrefix(prefix, args)),
    warn: (...args) => console.warn(...withPrefix(prefix, args)),
    error: (...args) => console.error(...withPrefix(prefix, args)),
    debug: (...args) => console.debug(...withPrefix(prefix, args)),
    child: (bindings) => {
      const childName = bindings?.name ? (resolvedName ? `${resolvedName}:${bindings.name}` : bindings.name) : resolvedName;
      return createLogger(childName);
    },
  };
}
