import type { Wakeups } from "@t3tools/client-runtime/connection";

export type MobileApplicationActiveWakeup = Extract<
  Wakeups.ConnectionWakeup,
  "application-active-probe"
>;

export function mobileApplicationActiveWakeup(): MobileApplicationActiveWakeup {
  return "application-active-probe";
}
