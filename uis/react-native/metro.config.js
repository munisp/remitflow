const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const config = {
  transformer: {
    // wave14 perf (H1): defer module evaluation until first require() call
    // instead of evaluating every module in the bundle at startup. Cuts
    // cold-start JS execution for the 70+ screens that are rarely opened.
    inlineRequires: true,
  },
  resolver: {
    // Some transitive deps (e.g. superjson -> copy-anything) ship only a
    // modern "exports" map with no legacy "main" field; Metro's resolver
    // needs this on to find them.
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
