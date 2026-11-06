// app.json holds the app's configuration. The store identity of the mobile apps (Android application id, iOS bundle
// identifier) is not decided there yet, and a native build cannot be generated without one: it is named through the
// environment for that build. Without these variables the configuration is app.json's, unchanged.
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, ...(process.env.JAGENTCHILL_ANDROID_PACKAGE ? { package: process.env.JAGENTCHILL_ANDROID_PACKAGE } : {}) },
  ios: { ...config.ios, ...(process.env.JAGENTCHILL_IOS_BUNDLE_ID ? { bundleIdentifier: process.env.JAGENTCHILL_IOS_BUNDLE_ID } : {}) },
});
