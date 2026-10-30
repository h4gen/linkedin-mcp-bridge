import { Fault } from "./contracts.js";
export const planningWrites = new Set([
  "post_draft_create",
  "post_schedule",
  "scheduled_post_cancel",
]);
export function scheduleTime(value: string, now: number): string {
  const time = Date.parse(value);
  const max = new Date(now);
  max.setUTCMonth(max.getUTCMonth() + 3);
  if (
    !Number.isFinite(time) ||
    time % 60000 !== 0 ||
    time < now + 600000 ||
    time > max.getTime()
  )
    throw new Fault("invalid_schedule_time");
  return new Date(time).toISOString();
}
