/**
 * English dictionary for the `llm-retry` locale namespace.
 *
 * The same key set as `zh.ts`, which `test/verify.mjs` asserts key by key: a
 * label added to one side and forgotten on the other would otherwise ship as
 * the raw key.
 */

import type { LocaleDict } from '../../../platform/types'

export const RETRY_LOCALE_EN: LocaleDict = {
  "sectionLabel": "Model retry",
  "sectionIntro": "Configure automatic retries for model-request failures on every registered provider route: mode, attempt count, and backoff. Saving applies to the next failure — no dsh restart.",
  "heading": "Provider routes",
  "countRoutes": "{count} routes",
  "empty": "No provider route is registered. Configure a provider on the Models page and its retry policy appears here.",
  "unavailableLlm": "This deployment mounts no llm service, so the registered provider routes cannot be read.",
  "unavailableSettings": "This deployment mounts no settings service: policies are readable but cannot be saved.",
  "loadFailed": "Could not read the retry policies (HTTP {status})",
  "policyCustom": "Custom",
  "policyDefault": "Default",
  "edit": "Configure",
  "readOnly": "This provider declares no editable settings address, so its policy is read-only here.",
  "editTitle": "Configure the retry policy",
  "provider": "Route",
  "mode": "Mode",
  "modeNormal": "normal (bounded)",
  "modeAlways": "always (unbounded)",
  "maxRetries": "Max retries",
  "maxRetriesHelp": "Retries after the first request; 0 means no retry.",
  "unlimitedHelp": "always mode has no attempt limit: it stops on success, cancellation, or plugin disposal.",
  "initialDelayMs": "Initial delay (ms)",
  "maxDelayMs": "Max delay (ms)",
  "jitterRatio": "Jitter ratio (0 to 1)",
  "backoffHelp": "Each wait is the smaller of initial × 2^(n-1) and the maximum, times 1-r+2r×random; initial equal to the maximum with no jitter means a fixed interval.",
  "resetHint": "\"Reset to default\" removes this route's retryPolicy from the configuration file, restoring the adapter defaults.",
  "summaryRetries": "up to {count} retries",
  "summaryUnlimited": "no attempt limit",
  "summaryFixedDelay": "fixed {delay} ms",
  "summaryBackoffDelay": "{initial} → {maximum} ms",
  "summaryJitter": "jitter {ratio}",
  "save": "Save",
  "reset": "Reset to default",
  "cancel": "Cancel",
  "saveFailed": "Could not save (HTTP {status})",
  "conflict": "The configuration changed in another window or by hand; the page reloaded, please try again.",
  "codeUnknownProvider": "That provider is no longer registered.",
  "codeNotEditable": "That provider cannot be configured here.",
  "codeUnavailable": "This deployment is missing a required DSH service.",
  "invalidMaxRetries": "Max retries must be an integer no smaller than 0.",
  "invalidInitialDelay": "Initial delay must be a positive whole number of milliseconds no greater than 2147483647.",
  "invalidMaxDelay": "Max delay must be a positive whole number of milliseconds no greater than 2147483647.",
  "invalidOrder": "Initial delay cannot exceed the max delay.",
  "invalidJitter": "Jitter ratio must be between 0 and 1.",
}
