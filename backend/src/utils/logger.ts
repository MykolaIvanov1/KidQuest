import winston from 'winston';

// Callers log event names and identifiers only. Request bodies, headers and tokens are never logged.
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});
