import { pino, type Logger as PinoLogger } from 'pino';

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (bindings: { name?: string }) => Logger;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

function createPinoLogger(resolvedName?: string): PinoLogger {
  return resolvedName ? baseLogger.child({ name: resolvedName }) : baseLogger;
}

function wrapLogger(pinoLogger: PinoLogger, resolvedName?: string): Logger {
  return {
    info: (...args) => (pinoLogger.info as (...args: unknown[]) => void)(...args),
    warn: (...args) => (pinoLogger.warn as (...args: unknown[]) => void)(...args),
    error: (...args) => (pinoLogger.error as (...args: unknown[]) => void)(...args),
    debug: (...args) => (pinoLogger.debug as (...args: unknown[]) => void)(...args),
    child: (bindings) => {
      const childName = bindings?.name ? (resolvedName ? `${resolvedName}:${bindings.name}` : bindings.name) : resolvedName;
      const childLogger = pinoLogger.child(childName ? { name: childName } : {});
      return wrapLogger(childLogger, childName);
    },
  };
}

export function createLogger(name?: string | { name?: string }): Logger {
  const resolvedName = typeof name === 'string' ? name : name?.name;
  return wrapLogger(createPinoLogger(resolvedName), resolvedName);
}
