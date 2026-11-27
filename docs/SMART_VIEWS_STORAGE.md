# Smart Views: local storage candidate (draft)

This document proposes the storage architecture for review; it is not a production approval.

A view stores a name, the entered search string, source kind and ID, status, date, and existing sort settings. Results and article content are not stored. Opening a view sends the same search through the existing list pipeline; Miniflux remains authoritative for articles and read/star state. Saved views do not change All/Unread ordering rules.

The versioned `smart-views-v1` browser-local store partitions views by the existing normalized server URL and Miniflux user ID identity used for homepage settings. Credentials are not stored in the view record. Controls are unavailable until that identity is known. Signing out retains views on this browser for that account; a different account does not see them. Browser storage may be cleared by the user, browser, or site-data policy. This is not encrypted, synchronized, or suitable for secrets in search strings.

The search dialog provides per-view deletion, account-level reset, and JSON export of the current account's views. Export is a user-controlled file and may include sensitive search text. Views are not included in the existing settings backup; import and cross-device synchronization are not provided in this MVP. Deleting/resetting a view does not alter Miniflux content. A missing source prevents opening its view and leaves the view available to delete. Storage schema versioning does not imply compatibility with future schema versions.

Concurrent tabs use last-writer-wins browser storage; simultaneous edits can overwrite one another.

Validation still required: real browser and device testing of navigation, selection, search parity, offline/error behavior, and persistence; assess concurrent-tab updates and site storage failures before release. Opening a view does not rewrite the user's global status and sort preferences: the view applies its status and sort in memory only while it is active (a session-only atom, never persisted), `settings` in browser storage keeps the user's own values throughout, and leaving the view restores them exactly. A view ends when the list stops matching it (another source, a different search or date, a deleted view, a different account or session, or an explicit status/sort change, which is then kept as the user's own choice). No deploy or merge is authorized by this document.

## Smart View polish (NF-0301)

- Schema: unchanged (`smart-views-v1`, version 1). The active-view state and the pre-view preference snapshot are session-only and are not stored.
- Active view: the list header shows the view name, its predicates as chips (source, status, date, search text, sort) and one "Leave view" action; screen readers get a labelled region and a status message. Leaving returns to the underlying scope without the view's search or date and restores the user's preferences.
- Readable names: saving without a name, or with a name another view already uses, proposes `Status · Source · Date · "query"` (at most 60 characters, numbered when still taken). Names the user types are kept unchanged.
- Navigation: saved views appear under "Saved views" in the shared Sidebar, so the desktop sidebar and the compact Feeds drawer open a view in one interaction; they are native buttons, so Tab and Enter work. A view whose feed or category no longer exists is shown disabled.
- Shortcut key: not added. `hotkeys-schema.js` maps one action to a fixed list of keys and the settings table lists fixed actions; a per-view key would need a parameterised action, a settings UI for it and conflict handling for user-created views. Keyboard access is provided by the sidebar buttons instead.
- Mark-read: an unread view uses the same in-place update as All/Unread (an entry marked read stays where it is; the count is reconciled separately), so neither an explicit mark nor read-on-scroll moves the list. Only the entries the user marks, or scrolls past, are written.
