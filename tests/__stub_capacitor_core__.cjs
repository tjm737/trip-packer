/*
 * A Capacitor that reports an iOS native platform, for
 * tests/native-screens-disabled.test.cjs.
 *
 * The kill switch has to hold on iOS specifically, so the test needs the bridge
 * to claim iOS. Reporting an iOS platform makes the test the strongest case:
 * if the feature is off here, it is off on every platform.
 *
 * `isNativePlatform` returns true along with the platform because a real iOS
 * app reports both, and a stub that answered only one would not exercise the
 * condition the real code checks.
 */

class CapacitorException extends Error {}

module.exports = {
  Capacitor: {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: (name, implementations) => {
    // Mirror the real registerPlugin closely enough that the module under test
    // builds its surface the same way: the web implementation is what answers
    // when there is no native bridge, so it must be reachable and callable.
    const web = implementations && implementations.web;
    const impl = web ? web() : Promise.resolve({});
    const proxy = {};
    const methods = [
      "openPackingList",
      "openItinerary",
      "closeNativeScreen",
      "setFrame",
    ];
    for (const m of methods) {
      proxy[m] = async (...args) => {
        const resolved = await impl;
        if (typeof resolved[m] === "function") return resolved[m](...args);
        throw new CapacitorException(
          `${name}.${m}() is not implemented on web.`
        );
      };
    }
    return proxy;
  },
  CapacitorException,
};
