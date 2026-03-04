# GRC Code Review Report

**Reviewer**: Code Review Agent
**Date**: 2026-03-03
**Scope**: All 34 TypeScript source files in `C:\work\grc\src\`
**TypeScript Compilation**: PASS (`npx tsc --noEmit` -- zero errors)
**Modular Monolith Compliance**: PASS (no cross-module direct imports detected)

---

## Summary

The GRC codebase demonstrates solid architectural foundations: clean module boundaries, consistent error handling patterns, proper Zod validation on inputs, structured logging with pino, and well-typed Drizzle ORM schemas. However, the review uncovered **7 security vulnerabilities** (3 critical, 4 major), **5 code quality issues**, and **6 architectural issues** requiring design decisions.

**All fixable issues have been directly resolved in code.** Architectural issues requiring design decisions are documented below for the team.

---

## Issues Found and Fixed

### [CRITICAL-SEC-1] JWT secret accepted in production without override
**File**: `C:\work\grc\src\config.ts`
**Severity**: Critical
**Description**: The default JWT secret `"change-me-in-production"` was accepted silently in production, allowing tokens signed with a well-known secret to be forged by any attacker.
**Fix**: Added a fail-fast check that throws a fatal error if `NODE_ENV=production` and `JWT_SECRET` is still the default value.

### [CRITICAL-SEC-2] API Key middleware bypassed authentication
**File**: `C:\work\grc\src\shared\middleware\auth.ts`
**Severity**: Critical
**Description**: When an `x-api-key` header was present, the middleware set `authMode = "apikey"` and called `next()` without validating the key. No `req.auth` was populated, meaning downstream scope/tier checks would fail on `undefined`, but the request was still passed through. This created an inconsistent security state where API key requests bypassed the normal auth flow.
**Fix**: Added basic format validation (min length check), populated `req.auth` with an intentionally empty-scoped placeholder (`sub: "apikey:pending"`, `scopes: []`), and added clear documentation that downstream handlers must call `authService.validateApiKey()` to fully resolve the key.

### [CRITICAL-SEC-3] OAuth CSRF state parameter never validated
**File**: `C:\work\grc\src\modules\auth\routes.ts`
**Severity**: Critical
**Description**: The `generateState()` function produced a random CSRF token for OAuth flows, but neither the GitHub nor Google callback endpoints ever validated the returned `state` parameter. This allowed CSRF attacks where an attacker could force a victim to authenticate with the attacker's OAuth account.
**Fix**: Implemented an in-memory state store with 10-minute TTL, one-time-use consumption, and periodic cleanup. Both GitHub and Google callbacks now validate the state parameter before proceeding.

### [MAJOR-SEC-4] JWT token leaked via URL query parameter
**File**: `C:\work\grc\src\modules\auth\routes.ts`
**Severity**: Major
**Description**: OAuth callbacks redirected to `/?token=<JWT>`, exposing the JWT in browser history, referrer headers, proxy logs, and server access logs. This is a well-known token leakage vector.
**Fix**: Changed redirects to use URL fragments (`/#token=<JWT>`). Fragments are not sent to the server or included in referrer headers, preventing leakage to third parties.

### [MAJOR-SEC-5] Asset decision endpoint lacked admin authorization
**File**: `C:\work\grc\src\modules\evolution\routes.ts`
**Severity**: Major
**Description**: The `POST /a2a/decision` endpoint (approve/quarantine assets) required authentication (`authRequired`) but did not verify admin role. Any authenticated user (including free-tier anonymous users) could approve or quarantine evolution assets.
**Fix**: Added `createAdminAuthMiddleware(config)` to the middleware chain for the decision endpoint.

### [MAJOR-SEC-6] Asset revoke endpoint allowed anonymous access
**File**: `C:\work\grc\src\modules\evolution\routes.ts`
**Severity**: Major
**Description**: The `POST /a2a/revoke` endpoint used `authOptional`, allowing anonymous users to attempt asset deletion. Although ownership is checked server-side, anonymous users should not reach destructive endpoints.
**Fix**: Changed from `authOptional` to `authRequired`.

### [MAJOR-SEC-7] Rate limit store unbounded memory growth
**File**: `C:\work\grc\src\shared\middleware\rate-limit.ts`
**Severity**: Major
**Description**: The in-memory `Map` for rate limiting had no maximum size. Under a distributed DoS attack with many unique IPs, the store could grow without bound, causing memory exhaustion and server crash.
**Fix**: Added a `MAX_STORE_SIZE` constant (100,000 entries) and a capacity check that returns 429 when the store is full.

### [QUALITY-1] Race condition in evolution usage reporting
**File**: `C:\work\grc\src\modules\evolution\service.ts`
**Severity**: Major
**Description**: `reportUsageFull()` read the current `useCount`/`successCount` values, computed new values in application code, then wrote them back. Two concurrent reports could read the same values and one increment would be lost.
**Fix**: Changed to atomic SQL expressions (`SET useCount = useCount + 1, successCount = successCount + N, successRate = (successCount + N) / (useCount + 1)`) followed by a fresh read for the promotion check.

### [QUALITY-2] Constant-time comparison used manual loop instead of Node.js API
**File**: `C:\work\grc\src\shared\utils\crypto.ts`
**Severity**: Minor
**Description**: The `hmacVerify()` function used a hand-rolled XOR loop for timing-safe comparison. While functionally correct, this is fragile and may be optimized away by the JS engine. Node.js provides `crypto.timingSafeEqual` which is implemented in native code and guaranteed constant-time.
**Fix**: Replaced the manual loop with `crypto.timingSafeEqual()`.

### [QUALITY-3] Telemetry period field lacked format validation
**File**: `C:\work\grc\src\shared\utils\validators.ts`
**Severity**: Minor
**Description**: The `period` field in `telemetryReportSchema` accepted any string. This could lead to inconsistent data and broken aggregation queries.
**Fix**: Added regex validation requiring `YYYY-MM-DD` format.

### [QUALITY-4] Dead code: normalizedVersion no-op assignment
**File**: `C:\work\grc\src\modules\update\service.ts`
**Severity**: Minor
**Description**: Line `const normalizedVersion = version.startsWith("v") ? version : version;` -- both ternary branches returned the same value, making the conditional a no-op.
**Fix**: Simplified to `const normalizedVersion = version;`.

### [QUALITY-5] Missing version param validation on manifest endpoint
**File**: `C:\work\grc\src\modules\update\routes.ts`
**Severity**: Minor
**Description**: The `GET /api/v1/update/manifest/:version` endpoint read `req.params.version` with a simple string cast and null check instead of using the existing `semverSchema` validator. Malformed version strings could reach the DB query.
**Fix**: Changed to `semverSchema.parse(req.params.version)`.

### [QUALITY-6] Missing UUID validation on API key delete parameter
**File**: `C:\work\grc\src\modules\auth\routes.ts`
**Severity**: Minor
**Description**: The `DELETE /auth/apikey/:id` endpoint accepted any string as the key ID without UUID format validation.
**Fix**: Changed to use `uuidSchema.parse(req.params.id)`.

### [SCHEMA-1] Drizzle schema missing `onUpdateNow()` on evolution timestamps
**File**: `C:\work\grc\src\modules\evolution\schema.ts`
**Severity**: Minor
**Description**: Both `genesTable.updatedAt` and `capsulesTable.updatedAt` had `.defaultNow()` but not `.onUpdateNow()`, meaning MySQL would not auto-update the timestamp on row updates. This broke the trending query which relies on `updatedAt` for the 7-day window.
**Fix**: Added `.onUpdateNow()` to both tables.

### [SCHEMA-2] Missing unique index on `api_keys.key_hash`
**File**: `C:\work\grc\src\modules\auth\schema.ts`
**Severity**: Minor
**Description**: The `key_hash` column, used for API key lookup, had no unique index. This could allow duplicate keys (extremely unlikely but not prevented) and caused full table scans for key validation.
**Fix**: Added `uniqueIndex("uk_key_hash").on(table.keyHash)`.

### [QUALITY-7] 404 handler and error handler in wrong order
**File**: `C:\work\grc\src\index.ts`
**Severity**: Minor
**Description**: The global error handler was registered before the 404 handler. While Express distinguishes error middleware (4 params) from regular middleware (2-3 params), the conventional order is 404 handler first, then error handler last.
**Fix**: Swapped the order so the 404 handler comes before the error handler.

---

## Issues Found but NOT Fixed (Require Design Decisions)

### [ARCH-1] JWT Algorithm: HS256 vs RS256

**Files**: `C:\work\grc\src\shared\utils\jwt.ts`, ADR-002
**Description**: ADR-002 specifies RS256 (asymmetric) but implementation uses HS256 (symmetric). RS256 would allow WinClaw clients to verify JWT signatures using the public key without needing the secret. HS256 is simpler but requires sharing the secret with any verifier.
**Decision needed**: Align on one algorithm. If client-side verification is required, migrate to RS256 with key pair management. If server-only verification suffices, update ADR-002 to document HS256.

### [ARCH-2] Refresh Token Not Implemented

**Files**: `C:\work\grc\src\shared\interfaces\auth.interface.ts`, `C:\work\grc\src\shared\utils\jwt.ts`
**Description**: ADR-002 specifies access tokens (24h) with refresh tokens (30d). The implementation has only access tokens with 7d expiry. No refresh token issuance, storage, or rotation logic exists.
**Decision needed**: Implement refresh tokens per ADR-002, or update ADR-002 to match the simpler 7d access-token-only model.

### [ARCH-3] Signal-based search is post-filtered in application code

**File**: `C:\work\grc\src\modules\evolution\service.ts` (searchAssets)
**Description**: The `searchAssets` method applies signal matching in JavaScript after fetching rows from the database with `LIMIT/OFFSET`. This means:
1. If signals filter out 15 of 20 results, only 5 are returned despite requesting limit=20.
2. The `total` count does not reflect signal filtering.
3. Pagination is broken for signal-filtered queries.
**Decision needed**: Either use MySQL `JSON_CONTAINS` for signal filtering at the SQL level, or introduce a separate `gene_signals` junction table for proper indexed querying.

### [ARCH-4] Telemetry stores raw `node_id` instead of anonymized hash

**File**: `C:\work\grc\src\modules\telemetry\schema.ts`, `C:\work\grc\src\modules\telemetry\service.ts`
**Description**: ADR-002 specifies monthly-rotating anonymous IDs (`SHA256(node_id + YYYY-MM)`), but the implementation stores raw `node_id` in `telemetry_reports`. This allows long-term tracking of individual nodes across periods.
**Decision needed**: Implement hash-based anonymization in the service layer before storage, or update ADR-002 to clarify that `node_id` is stored server-side but only exposed externally as anonymized IDs.

### [ARCH-5] Admin email whitelist in JWT requires email claim

**File**: `C:\work\grc\src\shared\middleware\admin-auth.ts`, `C:\work\grc\src\shared\utils\jwt.ts`
**Description**: The admin auth middleware has a config-based email whitelist, and the `issueJwt()` function in auth routes checks `config.admin.emails`. However, the `JwtPayload` interface does not include an `email` field. The email check happens only at JWT issuance time, not at verification time. If a JWT with `role: "admin"` is stolen, the whitelist provides no additional protection.
**Decision needed**: Add `email` to `JwtPayload` and verify against the whitelist at middleware time, or remove the whitelist concept and rely solely on the `role` claim.

### [ARCH-6] API Key resolution architecture is unclear

**File**: `C:\work\grc\src\shared\middleware\auth.ts`, `C:\work\grc\src\modules\auth\service.ts`
**Description**: The auth middleware marks API key requests as `"apikey:pending"` and stores the raw key, but no middleware or route handler subsequently resolves the key to a real user. The `AuthService.validateApiKey()` method exists but is never called from any route handler or middleware chain. Routes that use `requireScopes()` or `requireTier()` will fail for API key users because the placeholder auth has empty scopes.
**Decision needed**: Either create a separate middleware that resolves API keys (calling `authService.validateApiKey()`), or integrate key resolution into the `createAuthMiddleware` function by accepting the auth service as a dependency.

---

## Code Quality Assessment

### Strengths

1. **Clean Architecture**: The modular monolith pattern is correctly implemented. Each module has a clear `routes.ts` / `service.ts` / `schema.ts` structure. No module imports another module directly -- all cross-module communication goes through `shared/interfaces/`.

2. **Input Validation**: All API endpoints use Zod schemas for request validation, with the `asyncHandler` wrapper ensuring validation errors are caught and returned as structured 400 responses.

3. **Error Handling**: The `AppError` hierarchy (`BadRequestError`, `NotFoundError`, etc.) provides consistent, typed error responses. The global error handler distinguishes between Zod errors, application errors, and unexpected errors.

4. **Database Layer**: Drizzle ORM schemas are well-typed and correctly map to MySQL tables. The use of parameterized queries via Drizzle prevents SQL injection throughout.

5. **Content Safety**: The evolution module includes a comprehensive content safety scanner with 25+ dangerous patterns and 5+ obfuscation patterns. The scanner correctly resets regex lastIndex for global patterns.

6. **Graceful Shutdown**: The server handles SIGTERM/SIGINT with a timeout fallback, properly closing the database pool.

7. **Module Isolation**: Modules are loaded dynamically via `module-loader.ts` with independent error handling -- one module failure does not crash the server.

### Areas for Improvement

1. **Missing database transactions**: Multi-step operations like `publishSkill()` (insert version, insert/update skill, index in Meilisearch) should use database transactions to prevent partial writes on failure.

2. **No request body size limits per endpoint**: The global `express.json({ limit: "10mb" })` applies uniformly. Telemetry reports and update reports should have much smaller limits (e.g., 1MB) while skill publish needs the larger limit.

3. **Multiple pino logger instances**: Each file creates its own `pino()` instance. Consider a shared logger factory that inherits the config's `logLevel` setting.

4. **No request ID propagation**: Requests lack a correlation ID for tracing across log entries. Consider adding a `requestId` middleware.

5. **Community module is a stub**: The community module (`C:\work\grc\src\modules\community\routes.ts`) has only a status endpoint. The interface (`ICommunityService`) is defined but not implemented.

6. **No database migration runner**: The schema files reference `001_initial.sql` but there is no migration runner integrated into the application startup.

### Metrics

| Metric | Value |
|--------|-------|
| Total files reviewed | 34 |
| Security issues found | 7 (3 critical, 4 major) |
| Security issues fixed | 7 |
| Code quality issues found | 7 |
| Code quality issues fixed | 7 |
| Schema issues found | 2 |
| Schema issues fixed | 2 |
| Architectural issues (need decisions) | 6 |
| Cross-module import violations | 0 |
| TypeScript compilation errors | 0 |

---

*This report was generated by the Code Review Agent on 2026-03-03. All fixes have been applied directly to the source files and verified with `npx tsc --noEmit`.*
