export type SupervisorEvent = { id: string; type: "user" | "assistant" | "command" | "status" | "approval_request" | "approval_decision"; text: string };
type SupervisorState = { events: SupervisorEvent[]; busy: boolean; status: "idle" | "running" | "failed" | "interrupted" };

export function latestCompletedResponse(state?: SupervisorState): SupervisorEvent | undefined {
  if (!state || state.busy || state.status !== "idle") return undefined;
  let candidate: SupervisorEvent | undefined;
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index];
    if (event.type === "user") return candidate;
    if (!candidate && event.type === "assistant" && event.text.trim()) candidate = event;
  }
  return undefined;
}
