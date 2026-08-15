# FishAndSpices AI Marketplace Assistant Tools

## 1) Tooling principles

- Tools are server-executed only.
- Tools are explicitly allowlisted by user context.
- Every tool call is logged with args, result status, and latency.
- Write tools require authenticated customer session and CSRF token.
- Admin tools are isolated from customer assistant policies.

## 2) Tool groups

### A) Public discovery tools (anonymous and authenticated)

1. `marketplace_list_categories`
   - maps to: `listMarketplaceCategories(pool)`
   - source: `server/services/marketplace.js`

2. `marketplace_list_products`
   - params: `category`, `query`, `limit`
   - maps to: `listMarketplaceProducts(pool, filters)`

3. `marketplace_search_listings`
   - params: `role`, `category`, `product`, `country`, `query`, `sort`, `page`, `pageSize`
   - maps to: `listMarketplaceListings(pool, filters)`

4. `marketplace_get_listing_detail`
   - params: `role`, `slug`
   - maps to: `getMarketplaceListingBySlug(pool, { role, slug })`

### B) Authenticated customer tools

1. `marketplace_create_contact_request`
   - maps to: `createContactRequest(pool, payload)`
   - requires: customer session + CSRF + policy checks.

2. `marketplace_create_quote`
   - maps to: `createQuote(pool, payload)`
   - requires: customer session + CSRF + policy checks.

3. `marketplace_save_item`
   - maps to: `saveMarketplaceItem(pool, payload)`

4. `marketplace_remove_saved_item`
   - maps to: `removeMarketplaceItem(pool, payload)`

5. `marketplace_get_dashboard`
   - maps to: `getMarketplaceDashboard(pool, { userId })`

### C) Non-transactional helper tools

1. `assistant_explain_next_step`
   - no DB side effects,
   - creates structured guidance for buyer/seller journeys.

2. `assistant_generate_checklist`
   - no DB side effects,
   - returns compliance-ready checklist by role/category.

## 3) Actor policy matrix

| Tool | Anonymous | Authenticated customer | Admin assistant |
| --- | --- | --- | --- |
| marketplace_list_categories | allow | allow | allow |
| marketplace_list_products | allow | allow | allow |
| marketplace_search_listings | allow | allow | allow |
| marketplace_get_listing_detail | allow | allow | allow |
| marketplace_create_contact_request | deny | allow | deny |
| marketplace_create_quote | deny | allow | deny |
| marketplace_save_item | deny | allow | deny |
| marketplace_remove_saved_item | deny | allow | deny |
| marketplace_get_dashboard | deny | allow | deny |
| admin moderation tools | deny | deny | allow |

## 4) Suggested function schemas

Use strict mode schemas (`strict: true`) with `additionalProperties: false`.

### Example: search listings

```json
{
  "type": "function",
  "name": "marketplace_search_listings",
  "description": "Search public marketplace listings and buyer requirements.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "role": { "type": ["string", "null"], "enum": ["buyer", "seller", null] },
      "category": { "type": ["string", "null"] },
      "product": { "type": ["string", "null"] },
      "country": { "type": ["string", "null"] },
      "query": { "type": ["string", "null"] },
      "sort": { "type": "string", "enum": ["newest", "oldest", "quantity_desc", "quantity_asc"] },
      "page": { "type": "integer", "minimum": 1 },
      "pageSize": { "type": "integer", "minimum": 1, "maximum": 100 }
    },
    "required": ["role", "category", "product", "country", "query", "sort", "page", "pageSize"],
    "additionalProperties": false
  }
}
```

### Example: create contact request

```json
{
  "type": "function",
  "name": "marketplace_create_contact_request",
  "description": "Create a contact request for a listing on behalf of the authenticated customer.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "targetLeadId": { "type": "string", "format": "uuid" },
      "message": { "type": ["string", "null"] }
    },
    "required": ["targetLeadId", "message"],
    "additionalProperties": false
  }
}
```

## 5) Tool execution lifecycle

1. Assistant request arrives at `POST /api/v1/ai/chat`.
2. Server computes actor policy and exports only allowed tool definitions.
3. Model returns zero, one, or multiple tool calls.
4. Server validates args against schema, executes handlers, captures outcome.
5. Server sends `function_call_output` items back to model.
6. Server returns final assistant text and structured cards to client.

## 6) Error contracts

Tool failures return normalized machine-readable errors:

```json
{
  "ok": false,
  "errorCode": "AUTH_REQUIRED",
  "message": "Authentication required for this action.",
  "retryable": false
}
```

Recommended error codes:

- `AUTH_REQUIRED`
- `CSRF_INVALID`
- `FORBIDDEN_TOOL`
- `VALIDATION_ERROR`
- `RESOURCE_NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `INTERNAL_ERROR`

## 7) Tool-level observability

Capture these per call:

- conversation id,
- actor type and user id (if any),
- tool name,
- arg hash + safe preview,
- start/end timestamps,
- success/failure and error code,
- DB row ids touched (when relevant).
