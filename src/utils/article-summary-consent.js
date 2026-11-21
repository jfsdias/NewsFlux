// Legacy automatic-summary preferences did not record explicit consent.
export const automaticSummaryEnabled = (settings) =>
  settings?.aiSummaryAutoOnOpen === true && settings?.aiSummaryAutoConsent === true

export const automaticSummaryChoice = (enabled) => ({
  aiSummaryAutoOnOpen: enabled === true,
  aiSummaryAutoConsent: enabled === true,
})

// Importing settings is not a new consent to send article content.
export const withoutAutomaticSummaryConsent = (settings) => ({
  ...settings,
  aiSummaryAutoOnOpen: false,
  aiSummaryAutoConsent: false,
})

// Recheck consent after the catalog request and immediately before article transmission.
export const maySendAutomaticSummary = (automatic, settings) =>
  !automatic || automaticSummaryEnabled(settings)
