# Location privacy and operations

## Data categories

- `ip_approximate`: optional coarse access country, region and city from explicitly trusted, signed proxy headers. It never contains coordinates.
- `user_entered`: commercial contact, origin, stock, pickup, delivery or port information entered by the user.
- `device_permission`: one position returned after an explicit browser action and user confirmation.
- `map_pin`: a user-confirmed pin. No map provider is configured yet.
- `document_verified` and `inspection_verified`: administrator-controlled states requiring reviewer identity, time and method.
- Business-site and future transaction addresses: versioned operational history, separate from access location.

Device positions and map pins remain unverified. They are not promoted to document- or inspection-verified states by customer APIs.

## Request-path trust

The inspected Railway staging path is served by Railway Hikari. The current public domain is not a verified Cloudflare visitor-header path. The application therefore treats approximate location as unavailable by default.

`APPROXIMATE_LOCATION_PROVIDER=signed_proxy` may be enabled only when a controlled upstream removes client-supplied location headers, derives coarse values itself, and adds the custom `x-fas-*` headers with `x-fas-location-proxy-token`. `LOCATION_PROXY_SECRET` must be stored as a hosted secret. Generic `CF-*`, forwarding or client-supplied country headers are ignored.

## Consent and browser behavior

- Device geolocation is never requested on load.
- The browser prompt follows the user selecting “Use my current location.”
- One `getCurrentPosition` request is made; `watchPosition` and background tracking are not used.
- Denial, timeout and unavailability leave manual entry and submission usable.
- Coordinates stay in page memory until final submission and are included only after a separate confirmation.
- General location collection and precise-location collection are recorded separately with a text version and time.

## Visibility and use

Precise coordinates are private to the account owner and authorised operations. Public lead responses expose only success and a reference. Coordinates must not enter logs, audit JSON, notification subjects, WhatsApp URLs or coarse analytics. Broad location may support qualification, matching, logistics planning, regional analytics and review.

A claimed-country/access-country difference creates an administrator review signal only. It does not modify account status, fraud classification or lead acceptance automatically.

## Retention and correction

User-entered corrections create replacement records. Unreferenced records may be archived. Records referenced by leads, offers, requirements or versioned sites are preserved for operational history and a restricted-retention request is recorded. Deletion and correction requests are ownership-scoped and auditable.

The default retention setting is `LOCATION_RETENTION_DAYS=365`; operational cleanup must not erase records under legal, contractual, security or immutable-history retention. Retention periods and international processing requirements require jurisdiction-specific legal review.

## Future integration

Before adding a map, logistics, shipment or inspection provider, review its privacy terms, precision, retention, cross-border processing, sub-processors and credential handling. Do not place coordinates in query-string URLs. Add explicit foreign keys only after the owning operational tables exist.
