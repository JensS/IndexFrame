# Security policy

## Supported versions

Indexframe is currently pre-1.0. Security fixes are applied to the latest revision on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for suspected vulnerabilities or include secrets, access tokens, private library metadata, or personal assets in a report.

Include the affected component, reproduction steps, impact, and any suggested mitigation. Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Deployment responsibility

Indexframe handles private media and WebDAV credentials. Operators should use HTTPS, a dedicated expiring OpenCloud App Token, a unique archive password, encrypted sessions, persistent backups, and current container images. Keep writes disabled until the connected libraries have been audited and backed up.
