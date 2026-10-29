export type TurnTiming = { startedAt: string; finishedAt?: string; status?: string; interruptionObservedAt?: string };
export type TimingEvent = { type: string; turnKey?: string; startedAt?: string; finishedAt?: string; interruptionObservedAt?: string; status?: string };
export type TimingState = { turns: Record<string, TurnTiming>; active?: string };

export function updateTiming(state: TimingState, event: TimingEvent): TimingState {
  const key = event.turnKey;
  if (!key) return state;
  if (event.type === "user" && validTime(event.startedAt)) return { turns: { ...state.turns, [key]: { startedAt: event.startedAt! } }, active: key };
  if (event.type !== "finished" || !state.turns[key]) return state;
  return { turns: { ...state.turns, [key]: { ...state.turns[key], finishedAt: event.finishedAt, interruptionObservedAt: event.interruptionObservedAt, status: event.status ?? "unknown" } }, active: state.active === key ? undefined : state.active };
}

export function timingLabel(timing: TurnTiming | undefined, now: number, running: boolean): string | undefined {
  if (!timing || !validTime(timing.startedAt)) return undefined;
  const start = Date.parse(timing.startedAt);
  if (timing.status && !validTime(timing.finishedAt)) return `${timing.status === "interrupted" ? "Interrupted" : timing.status === "failed" ? "Failed" : "Stopped"} · duration unavailable`;
  if (!timing.status && !running) return undefined;
  const end = timing.status ? Date.parse(timing.finishedAt!) : now;
  if (end < start) return `${timing.status === "interrupted" ? "Interrupted" : timing.status === "failed" ? "Failed" : "Stopped"} · duration unavailable`;
  const seconds = Math.floor((end - start) / 1000);
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  const label = !timing.status ? "Working for" : timing.status === "completed" ? "Worked for" : timing.status === "interrupted" ? "Interrupted after" : "Failed after";
  return `${label} ${duration}`;
}
function validTime(value?: string) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
