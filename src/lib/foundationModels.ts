import { registerPlugin } from "@capacitor/core";

/*
 * TypeScript surface for the FoundationModels Capacitor plugin.
 *
 * The web layer talks to this, never to Capacitor directly, so the rest of the
 * app has one typed place to import from and one place to change if the bridge
 * moves.
 *
 * Everything here degrades rather than throws. On the web, in a browser, on an
 * older iOS build -- anywhere the plugin is absent -- `isAvailable()` resolves
 * to a not-available report and the UI hides the suggestions it cannot
 * generate. That is why the failure mode is a resolved report and not a
 * rejected promise: a missing plugin is the expected case on most platforms,
 * so treating it as an error would mean every caller needs a try/catch around
 * a situation that is entirely normal.
 */

/** Stable machine-readable reasons the model may be unusable. */
export type UnavailableReason =
  | "available"
  | "os_too_old"
  | "device_not_eligible"
  | "not_enabled"
  | "model_not_ready"
  | "unknown";

/** The availability report the plugin answers with. */
export interface AvailabilityReport {
  available: boolean;
  reason: UnavailableReason;
  /** Safe to show to a user directly. */
  message: string;
}

/** Result of a structured generation. */
export interface StructuredResult {
  text: string;
  /** JSON schema string describing the requested shape. */
  schema: string;
  fields: string[];
}

interface FoundationModelsPlugin {
  isAvailable(): Promise<AvailabilityReport>;
  generate(options: { prompt: string }): Promise<{ text: string }>;
  generateStructured(options: {
    prompt: string;
    fields: string[];
  }): Promise<StructuredResult>;
}

const Plugin = registerPlugin<FoundationModelsPlugin>("FoundationModels");

/**
 * The report returned when the plugin is not present at all.
 *
 * Reason is `os_too_old` rather than a distinct "no plugin" token because from
 * the user's point of view the two are the same thing: this build cannot do
 * on-device suggestions. Collapsing them keeps the UI's branch count down.
 */
const NO_PLUGIN: AvailabilityReport = {
  available: false,
  reason: "os_too_old",
  message: "Suggestions need the iOS app on iOS 26 or later.",
};

/**
 * Report whether on-device suggestions can be used right now.
 *
 * Never rejects. Callers can gate UI on this without a try/catch.
 */
export async function checkAvailability(): Promise<AvailabilityReport> {
  try {
    if (!Plugin?.isAvailable) return NO_PLUGIN;
    return await Plugin.isAvailable();
  } catch {
    /*
     * A throw here means the bridge is broken in a way we cannot act on
     * (a malformed native call, a plugin registered under another name).
     * Reporting it as "unavailable" is still the correct behaviour: the UI
     * falls back to its non-AI path, which is a working app.
     */
    return {
      available: false,
      reason: "unknown",
      message: "On-device suggestions are unavailable.",
    };
  }
}

/**
 * Generate plain text on-device.
 *
 * Returns null when the model is unavailable or generation fails, so callers
 * can treat "no suggestion" as a normal state rather than an exception.
 */
export async function generateText(prompt: string): Promise<string | null> {
  try {
    if (!Plugin?.generate) return null;
    const { text } = await Plugin.generate({ prompt });
    return text?.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Generate a structured object on-device, parsed into the given shape.
 *
 * The model is asked for JSON; it does not always comply perfectly. Models
 * variously wrap output in code fences, prefix it with a sentence, or emit
 * trailing commas. So the text is extracted and parsed defensively, and a
 * failure returns null rather than throwing -- a malformed suggestion should
 * cost the user a suggestion, not an error screen.
 */
export async function generateObject<T extends Record<string, unknown>>(
  prompt: string,
  fields: string[]
): Promise<T | null> {
  try {
    if (!Plugin?.generateStructured) return null;
    const { text } = await Plugin.generateStructured({ prompt, fields });
    return parseLooseJson<T>(text);
  } catch {
    return null;
  }
}

/**
 * Parse JSON that may be wrapped in prose or code fences.
 *
 * Exported for testing. Kept deliberately small: it finds the outermost
 * {...} span and parses that, rather than attempting repair, so a genuinely
 * malformed response fails instead of being silently half-read.
 */
export function parseLooseJson<T>(raw: string): T | null {
  if (!raw) return null;

  // Strip a fenced block if one is present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
