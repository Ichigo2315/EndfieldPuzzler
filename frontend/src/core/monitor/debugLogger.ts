export type LogStage =
  | 'model-load' | 'yolo-roi' | 'yolo-cells'
  | 'map-parse' | 'constraint-row' | 'constraint-col'
  | 'piece-parse' | 'solve' | 'general';

export type LogLevel = 'info' | 'warning' | 'error';

export interface DebugLogEntry {
  id: string;
  timestamp: Date;
  type: LogLevel;
  stage: LogStage;
  message: string;
  data?: Record<string, unknown>;
}

class DebugLogger {
  private logs: DebugLogEntry[] = [];
  private maxLogs = 200;
  private listeners: Array<() => void> = [];

  private emit() { this.listeners.forEach(fn => fn()); }
  subscribe(fn: () => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }

  log(type: LogLevel, stage: LogStage, message: string, data?: Record<string, unknown>) {
    this.logs.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      type, stage, message, data,
    });
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-this.maxLogs);
    const c = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    c(`[${stage}] ${message}`, data ?? '');
    this.emit();
  }

  info(stage: LogStage, msg: string, data?: Record<string, unknown>) { this.log('info', stage, msg, data); }
  warn(stage: LogStage, msg: string, data?: Record<string, unknown>) { this.log('warning', stage, msg, data); }
  error(stage: LogStage, msg: string, data?: Record<string, unknown>) { this.log('error', stage, msg, data); }

  getLogs(): DebugLogEntry[] { return [...this.logs]; }
  clear() { this.logs = []; this.emit(); }
}

export const debugLogger = new DebugLogger();
