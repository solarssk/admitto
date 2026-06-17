type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function log(level: LogLevel, msg: string, fields: LogFields = {}) {
  const entry = { level, msg, ts: new Date().toISOString(), ...fields };
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, fields?: LogFields) => log("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => log("error", msg, fields),
};
