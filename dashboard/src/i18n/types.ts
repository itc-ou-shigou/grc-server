import 'i18next';

// Type-safe translation keys
// In a full implementation, these would be generated from the JSON files
// For now, we declare the module augmentation structure

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    // Resources type can be added later for full type safety
    // by importing the JSON types from /public/locales/en/*.json
  }
}
