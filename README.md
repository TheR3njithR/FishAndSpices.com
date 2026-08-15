# Fish & Spices

Phase 2 static website for `fishandspices.com`, an independent managed B2B lead-qualification and commercial-introduction platform for fish, seafood and spices.

## Local preview

From this directory, run:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`.

## Project structure

- `index.html` - semantic homepage and SEO metadata
- `buy.html` - buyer entry and fish/spice qualification workflow
- `sell.html` - private seller entry and fish/spice qualification workflow
- `fish.html`, `spices.html` - commercial category overviews
- `how-it-works.html`, `safety.html` - managed matching and verification guidance
- `contact.html`, `privacy.html`, `terms.html` - contact and legal information
- `assets/css/styles.css` - shared design system and responsive layouts
- `assets/css/pages.css` - Phase 2 page, form and review components
- `assets/js/main.js` - accessible mobile navigation, header and configured contact links
- `assets/js/lead-form.js` - conditional forms, validation, provisional references and review summaries
- `assets/js/config.js` - central business contact configuration
- `assets/brand/` - original logo mark and favicon
- `assets/images/` - locally stored photography
- `IMAGE-CREDITS.md` - image sources and usage notes

## Contact configuration

Edit `assets/js/config.js` to change the WhatsApp destination, business email or source domain. The configured values are active business contacts, not placeholders:

- WhatsApp: `918700732197` (international digits only)
- Email: `AuthenticKeralaSpice@gmail.com`

Do not duplicate contact destinations in form logic. The buyer/seller message links and Contact page read this central configuration.

## Static submission workflow

No backend or fake database is used. The browser validates required fields, creates a provisional lead reference, sanitizes values, and generates a structured review. The visitor must then choose WhatsApp or email and complete sending in that external application. Form data is not placed in browser storage.

Initial internal metadata is `Verification: Pending`, `Match: Not reviewed`, and `Follow-up: New`. These are workflow states, not public verification.
