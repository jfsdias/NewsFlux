# Smart Views: local storage decision (draft)

A view stores a name, the entered search string, source kind and ID, status, date, and existing sort settings. Results and article content are not stored. Opening a view sends the same search through the existing list pipeline; Miniflux remains authoritative for articles and read/star state. Saved views do not change All/Unread ordering rules.

The versioned `smart-views-v1` browser-local store partitions views by the existing normalized server URL and Miniflux user ID identity used for homepage settings. Credentials are not stored in the view record. Controls are unavailable until that identity is known. Signing out retains views on this browser for that account; a different account does not see them. Browser storage may be cleared by the user, browser, or site-data policy. This is not encrypted, synchronized, or suitable for secrets in search strings.

The search dialog provides per-view deletion, account-level reset, and JSON export of the current account's views. Export is a user-controlled file and may include sensitive search text. Views are not included in the existing settings backup; import and cross-device synchronization are not provided in this MVP. Deleting/resetting a view does not alter Miniflux content. A missing source prevents opening its view and leaves the view available to delete. Storage schema versioning does not imply compatibility with future schema versions.

Validation still required: real browser and device testing of navigation, selection, search parity, offline/error behavior, and persistence; assess concurrent-tab updates and site storage failures before release. Opening a view updates existing status and sort preferences to the saved values. No deploy or merge is authorized by this document.
