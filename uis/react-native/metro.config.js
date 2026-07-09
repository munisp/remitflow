const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const config = {
  resolver: {
    // Some transitive deps (e.g. superjson -> copy-anything) ship only a
    // modern "exports" map with no legacy "main" field; Metro's resolver
    // needs this on to find them.
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
