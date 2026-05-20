// detox.config.js - Detox E2E Test Configuration
// Production-grade end-to-end testing for Remittance Platform Mobile

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      '$0': 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  
  apps: {
    // iOS Apps
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/AgentBanking.app',
      build: 'xcodebuild -workspace ios/AgentBanking/AgentBanking.xcworkspace -scheme AgentBanking -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/AgentBanking.app',
      build: 'xcodebuild -workspace ios/AgentBanking/AgentBanking.xcworkspace -scheme AgentBanking -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    
    // Android Apps
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/debug/app-production-debug.apk',
      build: 'cd android && ./gradlew assembleProductionDebug assembleProductionDebugAndroidTest -DtestBuildType=debug',
      reversePorts: [8081],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/release/app-production-release.apk',
      build: 'cd android && ./gradlew assembleProductionRelease assembleProductionReleaseAndroidTest -DtestBuildType=release',
    },
  },
  
  devices: {
    // iOS Simulators
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15 Pro',
      },
    },
    'simulator.iphone14': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 14',
      },
    },
    'simulator.ipad': {
      type: 'ios.simulator',
      device: {
        type: 'iPad Pro (12.9-inch) (6th generation)',
      },
    },
    
    // Android Emulators
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_7_API_34',
      },
    },
    'emulator.pixel6': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_6_API_33',
      },
    },
    
    // Physical Devices (for CI)
    'attached.ios': {
      type: 'ios.device',
      device: {
        type: 'iPhone',
      },
    },
    'attached.android': {
      type: 'android.attached',
      device: {
        adbName: '.*',
      },
    },
  },
  
  configurations: {
    // iOS Configurations
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'ios.device.release': {
      device: 'attached.ios',
      app: 'ios.release',
    },
    
    // Android Configurations
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
    'android.device.release': {
      device: 'attached.android',
      app: 'android.release',
    },
  },
  
  // Artifacts configuration
  artifacts: {
    rootDir: './e2e/artifacts',
    plugins: {
      screenshot: {
        shouldTakeAutomaticSnapshots: true,
        keepOnlyFailedTestsArtifacts: true,
        takeWhen: {
          testStart: false,
          testDone: true,
        },
      },
      video: {
        enabled: true,
        keepOnlyFailedTestsArtifacts: true,
      },
      log: {
        enabled: true,
      },
      uiHierarchy: 'enabled',
    },
  },
  
  // Behavior configuration
  behavior: {
    init: {
      exposeGlobals: true,
      reinstallApp: true,
    },
    launchApp: 'auto',
    cleanup: {
      shutdownDevice: false,
    },
  },
};
