#!/usr/bin/env node
/*
 * Guards WHERE the on-device natural-language entry is offered, and whether an
 * unavailable control can explain itself.
 *
 * The bug this pins: the button sat inside `hidden sm:block`, so it was hidden
 * on every device narrower than 640px. That is backwards. The feature calls
 * Apple's on-device model through the Capacitor plugin, so it can ONLY work in
 * the iOS app -- i.e. on a phone -- and can NEVER work in a desktop browser. The
 * one surface where it was visible was the one surface where it was permanently
 * disabled, and the one surface where it could run never rendered it at all.
 *
 * These are structural assertions over the source, because the failure is a
 * Tailwind breakpoint and there is no DOM to query in a node test. They are
 * deliberately narrow: they check the relationship between the wrapper and the
 * button, not the exact wording of anything.
 */
const fs = require("fs");
const h = require("./harness.cjs");

const DASHBOARD = h.SRC + "/app/(app)/DashboardClient.tsx";
const BUTTON = h.SRC + "/components/NaturalLanguageTripButton.tsx";

(async () => {
  const dashboard = fs.readFileSync(DASHBOARD, "utf8");
  const button = fs.readFileSync(BUTTON, "utf8");

  await h.test("the NL entry is shown on phones, not hidden on them", () => {
    /*
     * Locate the wrapper that actually contains <NaturalLanguageTripButton ...>.
     * Matching a bare `sm:hidden` anywhere would pass against an unrelated div,
     * so the wrapper is identified by proximity to the component it wraps.
     */
    const m = dashboard.match(
      /<div className="([^"]*)">\s*<NaturalLanguageTripButton/
    );
    h.assert(m !== null, "could not find the wrapper around NaturalLanguageTripButton");
    const wrapperClasses = m[1];

    h.assert(
      wrapperClasses.includes("sm:hidden"),
      `the NL wrapper must be "sm:hidden" (visible below 640px, hidden above) ` +
        `so it appears where the model can actually run; found "${wrapperClasses}"`
    );

    /*
     * The specific regression: `hidden sm:block` means hidden below sm and
     * block above -- the exact inverse. Asserting the absence of a bare `hidden`
     * token catches that, and also catches someone prefixing it again later.
     */
    const tokens = wrapperClasses.split(/\s+/);
    h.assert(
      !tokens.includes("hidden"),
      `the NL wrapper must not carry a bare "hidden" class, which hides it on ` +
        `phones (the only place it works); found "${wrapperClasses}"`
    );
  });

  await h.test("an unavailable NL button states why, without needing hover", () => {
    /*
     * A disabled button fires no pointer events and cannot be focused, so the
     * hover/focus tooltip is doubly unreachable on touch -- which is precisely
     * the target platform. The reason must therefore be rendered as visible
     * text on that path.
     *
     * The check is that the unavailable branch renders the hint inside a <p>,
     * not only as a Tooltip label.
     */
    const unavailableBranch = button.match(
      /\{!available && !checking \? \(([\s\S]*?)\) : \(/
    );
    h.assert(
      unavailableBranch !== null,
      "could not find the `!available && !checking` branch in the NL button"
    );
    const branch = unavailableBranch[1];

    h.assert(
      /<p[\s\S]*?\{hint\}/.test(branch),
      "the unavailable branch must render {hint} as visible text in a <p>, " +
        "because a tooltip cannot be reached on a touch device"
    );

    /*
     * And the tooltip must NOT also wrap that branch, or the same sentence is
     * emitted twice on desktop widths.
     */
    h.assert(
      !/<Tooltip[\s\S]*?<\/Tooltip>/.test(branch),
      "the unavailable branch must not also render the Tooltip; the hint would " +
        "appear twice"
    );
  });

  await h.test("the available path still uses the tooltip", () => {
    /*
     * The counterpart to the previous test: when the model IS available the
     * control is interactive and hover/focus works, so it should keep the
     * tooltip rather than growing a second block of body text.
     */
    h.assert(
      /\) : \(\s*<Tooltip/.test(button),
      "the available branch should still render the Tooltip"
    );
  });

  h.summary();
})();
