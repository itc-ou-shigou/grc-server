# GRC Admin API & Dashboard SPA - Code Review Report

**Reviewer:** Opus 4.6 Reviewer Agent
**Date:** 2026-03-03
**Scope:** 6 backend admin-routes.ts files, module-loader.ts, dashboard SPA (13 pages, API client, hooks)
**ADR Reference:** ADR-002 Phase 3 Agent 3C spec

---

## Executive Summary

The admin API and dashboard SPA are well-structured overall, with consistent patterns across all 6 modules. Security fundamentals are solid: all routes are protected by JWT + admin role + email whitelist middleware, all params are validated with Zod, and all SQL uses parameterized Drizzle ORM. However, the review uncovered **7 Critical**, **14 Major**, and **12 Minor** issues that should be addressed before production deployment.

The most significant findings are:
1. Frontend-backend API contract mismatches (response shapes, endpoint URLs, field names)
2. Missing transactional integrity on multi-table delete operations
3. Cascading delete in community module leaves orphaned data
4. `useBanUser` hook sends wrong field name to backend
5. Overview page displays wrong data in "Published Skills" card

---

## Critical Issues

**Issue 1** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 370-378
- Problem: `useBanUser` sends `{ ban: boolean }` but the backend `banUserSchema` at `C:\work\grc\src\modules\auth\admin-routes.ts` line 40-42 expects `{ banned: boolean }`. The request body will fail Zod validation with a 400 error every time a user tries to ban/unban.
- Fix: Change the mutation payload from `{ ban }` to `{ banned: ban }`:
  ```ts
  apiClient.patch(`/api/v1/admin/auth/users/${userId}/ban`, { banned: ban })
  ```

---

**Issue 2** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 186-192, 198-209
- Problem: The frontend `PaginatedResponse<T>` interface expects `{ items, total, page, page_size, total_pages }` but the backend returns `{ data, pagination: { page, limit, total, totalPages } }`. Every paginated query hook will fail to render data because `data?.items` is always `undefined` (the backend sends `data` not `items`). Similarly, `data?.total_pages` does not exist at the top level.
- Fix: Either align the frontend type to match the actual backend response shape `{ data: T[], pagination: { page, limit, total, totalPages } }`, or create a response transformer in the API client that normalizes the backend format to the frontend expected format.

---

**Issue 3** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 240-243
- Problem: `useAdminSkills` calls `/api/v1/admin/clawhub/skills` but the backend mounts ClawHub admin routes at `/api/v1/admin/skills` (see `C:\work\grc\src\modules\clawhub\admin-routes.ts` line 284). The skills list endpoint is `GET /api/v1/admin/skills/` not `/api/v1/admin/clawhub/skills`. This results in 404 for all skill-related admin API calls.
- Fix: Change the URL to `/api/v1/admin/skills` in `useAdminSkills`, and fix `useChangeSkillStatus` (line 407) similarly from `/api/v1/admin/clawhub/skills/${skillId}/status` to `/api/v1/admin/skills/${skillId}/status`.

---

**Issue 4** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 247-251
- Problem: `useSkillDownloadStats` calls `/api/v1/admin/clawhub/download-stats` but the backend endpoint is `GET /api/v1/admin/skills/downloads/stats` (see `C:\work\grc\src\modules\clawhub\admin-routes.ts` lines 123-164). Both the path prefix (`clawhub` vs `skills`) and the sub-path (`download-stats` vs `downloads/stats`) are wrong.
- Fix: Change the URL to `/api/v1/admin/skills/downloads/stats`.

---

**Issue 5** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 436-444
- Problem: `useModeratePost` sends a POST to `/api/v1/admin/community/posts/${postId}/moderate` but the backend has no such endpoint. Post moderation is handled via `PATCH /api/v1/admin/community/posts/:id` with body `{ action, reason }` (see `C:\work\grc\src\modules\community\admin-routes.ts` lines 269-337). Additionally, the frontend sends `action: 'unhide'` which is not in the backend's `moderatePostSchema` enum (`["hide", "delete", "lock", "unlock", "pin", "unpin"]`).
- Fix: Change to `apiClient.patch(\`/api/v1/admin/community/posts/${postId}\`, { action })` and handle the `unhide` case by mapping it to a valid backend action or adding `unhide` support to the backend schema.

---

**Issue 6** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Line: 458-466
- Problem: `useArchiveChannel` calls `PATCH /api/v1/admin/community/channels/${channelId}/archive` but the backend has no `/archive` sub-route. Channel deletion uses `DELETE /api/v1/admin/community/channels/:id` (see `C:\work\grc\src\modules\community\admin-routes.ts` lines 185-218). This will return 404 for every archive attempt.
- Fix: Either add an `archive` endpoint to the backend (recommended: add `archived` column + PATCH endpoint), or change the frontend to use `apiClient.del(\`/api/v1/admin/community/channels/${channelId}\`)` and rename the hook to `useDeleteChannel`.

---

**Issue 7** (Severity: Critical)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Lines: 8-18, 43-56, 68-78, 85-90, 105-117, 130-140, 152-162
- Problem: Multiple TypeScript interfaces in hooks.ts use `snake_case` field names (e.g., `is_active`, `is_banned`, `key_prefix`, `download_count`, `display_name`, `author_name`, `file_size`, `from_version`, `last_heartbeat`, `registered_at`) but the backend Drizzle ORM returns `camelCase` field names (e.g., `isActive`, `keyPrefix`, `downloadCount`, `displayName`, `authorDisplayName`, `sizeBytes`, `fromVersion`, `lastHeartbeat`, `createdAt`). This means all frontend data bindings will display `undefined` for these fields.
- Fix: Align the frontend interfaces to match the actual Drizzle ORM output (camelCase), or add a serialization layer on the backend that converts to snake_case.

---

## Major Issues

**Issue 8** (Severity: Major)
- File: `C:\work\grc\src\modules\clawhub\admin-routes.ts`
- Lines: 271-274
- Problem: The skill deletion cascade (`skillDownloads` -> `skillVersions` -> `skills`) is not wrapped in a database transaction. If the process crashes between deleting downloads and deleting the skill, the database will be left in an inconsistent state with orphaned version records.
- Fix: Wrap the three delete operations in a `db.transaction()` call:
  ```ts
  await db.transaction(async (tx) => {
    await tx.delete(skillDownloadsTable).where(eq(skillDownloadsTable.skillId, id));
    await tx.delete(skillVersionsTable).where(eq(skillVersionsTable.skillId, id));
    await tx.delete(skillsTable).where(eq(skillsTable.id, id));
  });
  ```

---

**Issue 9** (Severity: Major)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Lines: 304-313, 356-365
- Problem: Post deletion in both the moderate action (case "delete") and the `DELETE /posts/:id` handler deletes replies and votes but does **not** delete votes that target individual replies of that topic. `communityVotesTable` entries with `targetType: "reply"` and `targetId` pointing to now-deleted replies become orphaned.
- Fix: Before deleting replies, first query all reply IDs for the topic, then delete votes targeting those replies:
  ```ts
  const replyIds = await db.select({ id: communityRepliesTable.id })
    .from(communityRepliesTable).where(eq(communityRepliesTable.topicId, id));
  if (replyIds.length > 0) {
    await db.delete(communityVotesTable).where(
      and(eq(communityVotesTable.targetType, "reply"),
          inArray(communityVotesTable.targetId, replyIds.map(r => r.id))));
  }
  ```

---

**Issue 10** (Severity: Major)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Lines: 304-320, 356-365
- Problem: Post deletion logic is duplicated between the `PATCH /posts/:id` handler (case "delete" in moderation) and the `DELETE /posts/:id` handler. Both perform the exact same cascade delete. This violates DRY and creates a maintenance risk where a fix in one path is forgotten in the other.
- Fix: Extract the deletion logic into a shared helper function and call it from both handlers.

---

**Issue 11** (Severity: Major)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Lines: 205-217
- Problem: Channel deletion does not check for or delete associated topics (posts). Deleting a channel with `communityTopicsTable` rows referencing it via `channelId` will either fail with a foreign key constraint error (if FK is enforced) or leave orphaned posts with a dangling `channelId`.
- Fix: Either cascade-delete all topics (and their replies/votes) in the channel before deleting the channel, or set the topics' `channelId` to NULL.

---

**Issue 12** (Severity: Major)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Lines: 304-320, 356-365
- Problem: Multi-table delete operations for posts (replies + votes + topic) are not wrapped in a transaction. A partial failure will leave the database in an inconsistent state.
- Fix: Wrap all deletes in `db.transaction()`.

---

**Issue 13** (Severity: Major)
- File: `C:\work\grc\src\modules\evolution\admin-routes.ts`
- Lines: 62-139
- Problem: The `/assets` endpoint's pagination is broken when `type` is not specified (i.e., fetching both genes and capsules). The offset is applied correctly only when filtering by a single type. When both types are queried, genes get `limit: ceil(limit/2)` with `offset: 0`, and capsules get `limit: floor(limit/2)` with `offset: 0`. This means page 2+ will always return the same data as page 1 because the offset is hardcoded to 0 for the combined view.
- Fix: Either implement proper UNION-based pagination using a raw SQL query, or apply the correct offset calculation for combined results. The simplest fix is to use a single SQL UNION query with proper LIMIT/OFFSET.

---

**Issue 14** (Severity: Major)
- File: `C:\work\grc\dashboard\src\pages\Overview.tsx`
- Lines: 56-59
- Problem: The "Published Skills" stat card displays `auth.data?.total_users` (total users count) instead of a skills-related metric. This is a copy-paste error that shows user count in place of skill count.
- Fix: Replace with actual skill count data. Either add a skills stats query to the Overview page, or create a dedicated endpoint that returns the total published skill count.

---

**Issue 15** (Severity: Major)
- File: `C:\work\grc\dashboard\src\pages\Overview.tsx`
- Lines: 74-78
- Problem: The "Update Success Rate" calculation multiplies by 100 (`(update.data?.success_rate ?? 0) * 100`) but the backend already returns the rate as a percentage (see `C:\work\grc\src\modules\update\admin-routes.ts` lines 328-333 where `successRate` is computed as `(successCount / totalReports) * 100`). This will display 9500% instead of 95%.
- Fix: Remove the `* 100` multiplication: `${(update.data?.success_rate ?? 0).toFixed(1)}%`.

---

**Issue 16** (Severity: Major)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Lines: 212-215
- Problem: `useAuthStats` expects `AuthStats` shape with fields like `total_users`, `active_users`, `growth_data`, etc. but the backend `/api/v1/admin/auth/stats` returns `{ stats: { totalUsers, tierDistribution, providerDistribution, newUsersLast7Days } }`. The response is wrapped in a `stats` object (not flat), uses camelCase, and has different field names (e.g., `newUsersLast7Days` vs `new_users_last_30d`). Also, `active_users`, `banned_users`, and `growth_data` are not returned by the backend at all.
- Fix: Align the frontend `AuthStats` interface to the actual backend response, or add the missing fields to the backend stats endpoint.

---

**Issue 17** (Severity: Major)
- File: `C:\work\grc\dashboard\src\api\hooks.ts`
- Lines: 328-333
- Problem: `useAdminChannels` expects the response type to be `Channel[]` (a flat array) but the backend returns `{ data: Channel[], pagination: {...} }`. The hook will fail to iterate over channels because the response object is not an array.
- Fix: Change the return type to match the actual paginated response, or add pagination params to the hook.

---

**Issue 18** (Severity: Major)
- File: `C:\work\grc\dashboard\src\pages\auth\Users.tsx`
- Line: 9
- Problem: The `TIERS` array includes `'enterprise'` and `'admin'` but the backend `changeTierSchema` only allows `["free", "contributor", "pro"]` (see `C:\work\grc\src\modules\auth\admin-routes.ts` line 37). Selecting "enterprise" or "admin" as a tier will fail validation with a 400 error.
- Fix: Align `TIERS` to `['free', 'contributor', 'pro']` matching the backend schema.

---

**Issue 19** (Severity: Major)
- File: `C:\work\grc\dashboard\src\api\client.ts`
- Lines: 3-9
- Problem: The JWT token is stored in `localStorage` which is vulnerable to XSS attacks. If any XSS vulnerability exists in the application (or a third-party dependency), an attacker can exfiltrate the admin JWT token from localStorage. For an admin panel, this is a high-risk concern.
- Fix: Use `httpOnly` cookies for JWT storage instead of localStorage. This requires backend changes to set the cookie on login and a credential inclusion mode on fetch requests. At minimum, consider adding a Content Security Policy and sanitizing all user-provided data rendered in the DOM.

---

**Issue 20** (Severity: Major)
- File: `C:\work\grc\dashboard\src\App.tsx`
- Lines: 17-41
- Problem: There is no route-level authentication guard. The entire admin SPA renders without checking if the user has a valid JWT token. An unauthenticated user can navigate to any dashboard page; API calls will fail with 401 but the UI renders as if accessible. This creates a confusing UX and potentially leaks page structure.
- Fix: Add an `AuthGuard` component that checks for a valid token (at minimum, existence + non-expired check) and redirects to a login page if absent. Wrap all `<Routes>` inside this guard.

---

**Issue 21** (Severity: Major)
- File: `C:\work\grc\src\modules\telemetry\admin-routes.ts`
- Lines: 237-269
- Problem: The `DELETE /reports/old` endpoint reads the `days` parameter from `req.query` (line 240) but uses the HTTP DELETE method. Query parameters on DELETE requests are unusual and may be stripped by some proxies/load balancers. More importantly, the schema uses `z.coerce.number()` on query params which could allow injection of unexpected values. The endpoint performs a **bulk delete** of potentially millions of rows without a confirmation step or dry-run mode, and the count-then-delete pattern is subject to TOCTOU race conditions.
- Fix: Consider changing to `POST /reports/cleanup` with a request body for the `days` parameter. Add a `dryRun` option that returns the count without deleting. Consider batching the delete to avoid locking the table for extended periods.

---

## Minor Issues

**Issue 22** (Severity: Minor)
- File: `C:\work\grc\src\modules\auth\admin-routes.ts` through `C:\work\grc\src\modules\community\admin-routes.ts`
- Problem: The `paginationSchema` is duplicated identically in all 6 admin route files. An identical `paginationSchema` already exists in `C:\work\grc\src\shared\utils\validators.ts` (lines 9-12).
- Fix: Import and reuse the shared `paginationSchema` from `../../shared/utils/validators.js` instead of redefining it in each module.

---

**Issue 23** (Severity: Minor)
- File: `C:\work\grc\src\modules\auth\admin-routes.ts`
- Line: 262
- Problem: The `DELETE /apikeys/:id` response uses `{ deleted: true }` while all other GET/PATCH endpoints use `{ data: ... }`. Similarly, `C:\work\grc\src\modules\clawhub\admin-routes.ts` line 278, `C:\work\grc\src\modules\update\admin-routes.ts` line 228, and `C:\work\grc\src\modules\community\admin-routes.ts` lines 216, 320, 369 all return `{ deleted: true }`. While internally consistent for deletes, the stats endpoints (`/stats`) use `{ stats: ... }` instead of `{ data: ... }`. This inconsistency means the frontend must handle three different response wrappers.
- Fix: Standardize on a single envelope format, e.g., `{ data: ... }` for all successful responses, including stats and delete confirmations.

---

**Issue 24** (Severity: Minor)
- File: `C:\work\grc\src\modules\update\admin-routes.ts`
- Lines: 36-46
- Problem: The `createReleaseSchema` uses `snake_case` field names (`download_url`, `size_bytes`, `checksum_sha256`, `min_upgrade_version`, `is_critical`) which do not match the Drizzle schema's camelCase property names (`downloadUrl`, `sizeBytes`, `checksumSha256`, `minUpgradeVersion`, `isCritical`). The handler manually maps between them (lines 134-139), which is fragile and error-prone.
- Fix: Use camelCase in the Zod schema to match the Drizzle schema, or use a `.transform()` in Zod to automatically convert snake_case to camelCase.

---

**Issue 25** (Severity: Minor)
- File: `C:\work\grc\src\modules\evolution\admin-routes.ts`
- Lines: 79-81
- Problem: The `assetListQuerySchema` accepts `category` as a filter, and it is applied to `genesTable.category` but **not** to `capsulesTable`. The capsules schema (see `C:\work\grc\src\modules\evolution\schema.ts`) does not have a `category` column. If a user filters by category, capsule results will be unfiltered.
- Fix: Either add a category column to capsules, or document in the API that category filtering only applies to genes, or skip the capsule query when category filter is active.

---

**Issue 26** (Severity: Minor)
- File: `C:\work\grc\src\modules\clawhub\admin-routes.ts`
- Lines: 32-35
- Problem: The `skillListQuerySchema` allows `authorId` as a filter string but does not validate it as a UUID. A malformed `authorId` value will be passed directly to the Drizzle `eq()` comparator. While Drizzle parameterizes this (so no SQL injection), it silently returns empty results for invalid UUIDs rather than giving a helpful error.
- Fix: Add `.uuid()` validation to the `authorId` field: `authorId: z.string().uuid().optional()`.

---

**Issue 27** (Severity: Minor)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Lines: 420-452
- Problem: The `/agents/:nodeId/ban` endpoint locks all posts by the agent but does not prevent the agent from creating new posts. A banned agent can continue posting after being "banned". The operation only locks existing posts. Also, there is no way to "unban" an agent -- the endpoint does not accept a `banned: boolean` toggle.
- Fix: Implement a proper ban mechanism that persists the ban state (e.g., a `bannedAt` timestamp on the node record) and check it during post creation. Add an unban option to the endpoint.

---

**Issue 28** (Severity: Minor)
- File: `C:\work\grc\dashboard\src\components\DataTable.tsx`
- Lines: 30-31
- Problem: Two identical `key` columns can appear in the same row (e.g., `Users.tsx` defines columns where `key: 'id'` appears twice -- once for ID display and once for Actions). The `<td key={col.key}>` at line 80 will produce duplicate React keys in the same parent, which React warns about and can cause rendering issues.
- Fix: Use a combination of `col.key` and `col.label` or an index for the `<td>` key, e.g., `key={\`${col.key}-${col.label}\`}`.

---

**Issue 29** (Severity: Minor)
- File: `C:\work\grc\dashboard\src\pages\auth\Users.tsx`
- Lines: 30, 150
- Problem: The `columns` array and `DataTable` `data` prop use type assertions (`as unknown as Record<string, unknown>[]`) to bridge the type mismatch. This bypasses TypeScript's type checking entirely, hiding potential runtime errors from mismatched field names.
- Fix: Define the `DataTable` component generics more precisely so that `Column<User>` can be used directly without unsafe casts. Consider making `DataTable` accept typed column definitions.

---

**Issue 30** (Severity: Minor)
- File: `C:\work\grc\dashboard\src\pages\Overview.tsx`
- Line: 20
- Problem: The `loading` state does not include `community.isLoading` even though community stats are used on the page (line 96). When community data is still loading, the "Pending Moderation" card will show 0 instead of a loading skeleton.
- Fix: Add `community.isLoading` to the loading condition.

---

**Issue 31** (Severity: Minor)
- File: `C:\work\grc\src\modules\auth\admin-routes.ts`
- Lines: 71-73
- Problem: The LIKE search uses `sql` template literal with user-provided `query.search` value embedded in the string pattern: `` sql`(${users.displayName} LIKE ${`%${query.search}%`}...` ``. While Drizzle parameterizes the value (so no SQL injection), the `%` wildcards allow users to craft patterns like `%` that match everything, or `_` which is a single-character wildcard in SQL LIKE. This is a minor information disclosure risk.
- Fix: Escape SQL LIKE special characters (`%`, `_`, `\`) in the search string before wrapping with wildcards.

---

**Issue 32** (Severity: Minor)
- File: `C:\work\grc\src\module-loader.ts`
- Lines: 99-110
- Problem: Admin routes are loaded immediately after main routes for each module, and failures are silently logged. However, there is no mechanism to detect or report admin route loading failures to the dashboard. An operator would need to check server logs to know that admin routes failed to load.
- Fix: Consider adding a `/api/v1/admin/health` endpoint that reports which admin modules loaded successfully, or include admin module status in the main health check response.

---

**Issue 33** (Severity: Minor)
- File: `C:\work\grc\src\modules\community\admin-routes.ts`
- Line: 20
- Problem: `nodeIdSchema` is imported from validators but only used once (line 424). Meanwhile, the `uuidSchema` is also imported. Both are correct for their use cases, but the `nodeIdSchema` regex (`/^[a-zA-Z0-9_-]+$/`) allows a very broad range of strings (8-255 chars). Consider whether a tighter validation is appropriate for production.
- Fix: No immediate action required, but document the expected `nodeId` format for API consumers.

---

## Cross-Cutting Concerns

### Module Loader (PASS)
The `module-loader.ts` correctly loads admin routes after main routes for each module (lines 99-110). Admin route failures do not prevent main module operation. Admin routes are only loaded for enabled modules, which is correct.

### Admin Auth Middleware (PASS)
The `admin-auth.ts` middleware enforces three layers of security:
1. JWT authentication required (API keys explicitly rejected at line 24)
2. `role === "admin"` check in JWT claims (line 32)
3. Email whitelist cross-check when configured (lines 42-59)

This is a strong defense-in-depth approach.

### Circular Dependencies (PASS)
Admin route files only import from `shared/` and their own module's `schema.ts`. The only cross-module import is in `C:\work\grc\src\modules\community\admin-routes.ts` line 28 (`nodesTable` from `evolution/schema.ts`) and `C:\work\grc\src\modules\clawhub\admin-routes.ts` line 20 (`users` from `auth/schema.ts`). These are schema-only imports (table definitions, not business logic), which is acceptable per ADR-002's module dependency rules. However, ADR-002 section B states "each module can only operate on tables defined in its own schema.ts" and "cross-module data access must go through service interfaces." The direct schema imports technically violate this rule.

### SQL Injection (PASS)
All SQL operations use Drizzle ORM's parameterized query builder. No raw string interpolation was found in any SQL query. The `sql` template literals used (e.g., LIKE patterns, GROUP BY, DATE functions) all properly parameterize user inputs.

### Pagination (PASS)
All list endpoints enforce `max(100)` on the limit parameter via Zod. Default is 20. Page numbers are validated as positive integers.

---

## ADR-002 Compliance

### Agent 3C Spec Compliance
ADR-002 line 2214 specifies: `3C | Admin Dashboard | dashboard/ React SPA + 6 modules each with admin-routes.ts`

| Requirement | Status | Notes |
|-------------|--------|-------|
| React SPA in `dashboard/` | PASS | Vite + React Router + TanStack Query |
| 6 modules with `admin-routes.ts` | PASS | auth, clawhub, evolution, update, telemetry, community |
| Auth admin routes | PASS | Users CRUD, API keys, stats |
| ClawHub admin routes | PASS | Skills CRUD, categories, download stats |
| Evolution admin routes | PASS | Assets (genes+capsules), nodes, reports, stats |
| Update admin routes | PASS | Releases CRUD, reports, stats |
| Telemetry admin routes | PASS | Dashboard, reports, export, retention cleanup |
| Community admin routes | PASS | Channels CRUD, posts moderation, agents, stats |
| Module loader integration | PASS | Admin routes loaded after main routes per module |

### ADR-002 Code Structure Compliance
The actual file structure matches the ADR-002 appendix B specification (lines 2283-2341):
- `src/modules/{name}/admin-routes.ts` pattern followed for all 6 modules
- `dashboard/src/` with pages organized by module (`pages/auth/`, `pages/skills/`, etc.)
- Shared middleware in `src/shared/middleware/`

### Cross-Module Import Violation
- `clawhub/admin-routes.ts` imports `users` from `auth/schema.ts` (for JOIN queries)
- `community/admin-routes.ts` imports `nodesTable` from `evolution/schema.ts`

ADR-002 line 2360 states each module should only operate on its own schema.ts tables. While these imports are read-only JOINs (not mutations), they create coupling between modules. Per ADR-002, cross-module access should use service interfaces.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 7 |
| Major | 14 |
| Minor | 12 |
| **Total** | **33** |

### Priority Recommendations

**Immediate (Block deployment):**
1. Fix all 7 Critical issues -- the frontend-backend API contract mismatches render the entire dashboard non-functional
2. Fix Issue 8 (transaction safety on cascading deletes)
3. Fix Issue 20 (no auth guard on SPA routes)

**Before production:**
4. Fix Issues 9-12 (data integrity on community deletes)
5. Fix Issue 13 (evolution pagination bug)
6. Fix Issue 19 (localStorage JWT storage)
7. Fix Issues 14-18 (data display correctness)

**Technical debt:**
8. Fix Issue 22 (DRY pagination schemas)
9. Fix Issues 23-24 (response format consistency)
10. Address remaining Minor issues

---

*Report generated by Opus 4.6 Reviewer Agent on 2026-03-03*
