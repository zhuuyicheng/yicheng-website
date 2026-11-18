import type { Logger } from '../infra/logger.js';

/** One resource to release on shutdown. Steps run in the order they are given. */
export interface ShutdownStep {
  name: string;
  /**
   * `timeLeftMs`: time until the forced exit. Most steps ignore it; one that can use as much
   * time as it gets (the worker draining its buffer) takes it as its budget.
   */
  close: (timeLeftMs: number) => Promise<void>;
}

export interface GracefulShutdownOptions {
  logger: Logger;
  /** Hard deadline; after it the process exits with code 1 even if steps are still running. */
  timeoutMs: number;
  steps: readonly ShutdownStep[];
  /** Injectable for tests. Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Injectable for tests. */
  now?: () => number;
}

export interface GracefulShutdown {
  shutdown: (reason: string, exitCode?: number) => Promise<void>;
}

export function createGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const { logger, timeoutMs, steps } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const now = options.now ?? Date.now;
  let inProgress = false;

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (inProgress) {
      // Duplicate signals are normal (e.g. `tsx watch` and the terminal both forward Ctrl+C).
      // Ignore them; the deadline timer still guarantees the process exits.
      logger.warn({ reason }, 'shutdown already in progress, ignoring repeated request');
      return;
    }
    inProgress = true;
    logger.info({ reason }, 'shutdown started');

    const deadline = now() + timeoutMs;
    const forceExitTimer = setTimeout(() => {
      logger.error({ timeoutMs }, 'shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    forceExitTimer.unref();

    let finalExitCode = exitCode;
    for (const step of steps) {
      try {
        await step.close(Math.max(0, deadline - now()));
        logger.info({ step: step.name }, 'shutdown step completed');
      } catch (err) {
        // Keep going: one failing resource must not leave the others open.
        finalExitCode = 1;
        logger.error({ err, step: step.name }, 'shutdown step failed');
      }
    }

    clearTimeout(forceExitTimer);
    logger.info({ exitCode: finalExitCode }, 'shutdown complete');
    exit(finalExitCode);
  }

  return { shutdown };
}

/** Routes OS signals and fatal process errors into the graceful shutdown sequence. */
export function registerProcessHandlers(shutdown: GracefulShutdown, logger: Logger): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown.shutdown(signal);
    });
  }

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown.shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown.shutdown('unhandledRejection', 1);
  });
}
