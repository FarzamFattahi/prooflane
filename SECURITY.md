# Security and privacy

Prooflane processes selected images in your browser. The application has no image upload endpoint, analytics service, account system, or external model dependency. Fonts and application assets are bundled with the site. The hosting provider still receives the normal requests needed to serve the app.

An exported HTML report contains your original images and review notes. JSON exports contain review metadata and notes. Check those files before sharing them. Prooflane does not redact secrets from screenshots. Ignoring a rectangle excludes it from comparison; it does **not** remove that area from exported images.

Notes are rendered as text, and standalone HTML reports escape supplied text. Keep your browser updated when opening image files from unknown sources.

## Reporting a vulnerability

For a security concern, use [GitHub's private vulnerability reporting](https://github.com/farzamfattahi/prooflane/security/advisories/new) when enabled. If unavailable, open an issue describing the affected feature and how to contact you, without publishing sensitive data or exploit payloads. Ordinary bugs belong in [the issue tracker](https://github.com/farzamfattahi/prooflane/issues).

This is a community project without a guaranteed response-time agreement.
