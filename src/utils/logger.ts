/**
 * Structured logging utility for Bot Kun v2
 * Suitable for Railway deployment
 * Never logs secrets (tokens, API keys, credentials)
 */

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

class Logger {
  private formatLogEntry(entry: LogEntry): string {
    const { timestamp, level, message, context } = entry;
    let logLine = `[${timestamp}] [${level}] ${message}`;
    
    if (context && Object.keys(context).length > 0) {
      // Sanitize context to prevent leaking secrets
      const sanitizedContext = this.sanitizeContext(context);
      logLine += ` ${JSON.stringify(sanitizedContext)}`;
    }
    
    return logLine;
  }

  private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const secretKeys = ['token', 'key', 'password', 'secret', 'credential'];
    
    for (const [key, value] of Object.entries(context)) {
      const keyLower = key.toLowerCase();
      if (secretKeys.some(secret => keyLower.includes(secret))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    const logLine = this.formatLogEntry(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(logLine);
        break;
      case LogLevel.WARN:
        console.warn(logLine);
        break;
      case LogLevel.DEBUG:
        console.debug(logLine);
        break;
      default:
        console.log(logLine);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }
}

export const logger = new Logger();
