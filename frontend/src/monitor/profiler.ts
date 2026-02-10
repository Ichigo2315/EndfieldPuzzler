export type ProfileStage =
  | 'model-load'
  | 'yolo-roi'
  | 'yolo-cells'
  | 'map-parse'
  | 'constraint-row'
  | 'constraint-col'
  | 'piece-parse'
  | 'solve';

export interface StageRecord {
  stage: ProfileStage;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export const STAGE_COLORS: Record<ProfileStage, string> = {
  'model-load': '#6366f1',
  'yolo-roi': '#8b5cf6',
  'yolo-cells': '#a78bfa',
  'map-parse': '#06b6d4',
  'constraint-row': '#f59e0b',
  'constraint-col': '#f97316',
  'piece-parse': '#10b981',
  'solve': '#ef4444',
};

class Profiler {
  private records: StageRecord[] = [];
  private pending = new Map<ProfileStage, number>();
  private listeners: Array<() => void> = [];
  private _totalMs = 0;

  private emit() { this.listeners.forEach(fn => fn()); }
  subscribe(fn: () => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }

  reset() { this.records = []; this.pending.clear(); this._totalMs = 0; this.emit(); }

  start(stage: ProfileStage) { this.pending.set(stage, performance.now()); }

  end(stage: ProfileStage) {
    const startMs = this.pending.get(stage);
    if (startMs == null) return;
    this.pending.delete(stage);
    const endMs = performance.now();
    this.records.push({ stage, startMs, endMs, durationMs: endMs - startMs });
    this._totalMs = this.records.reduce((s, r) => s + r.durationMs, 0);
    this.emit();
  }

  getRecords(): StageRecord[] { return [...this.records]; }
  get totalMs(): number { return this._totalMs; }
}

export const profiler = new Profiler();
