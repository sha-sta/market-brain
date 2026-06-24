# Security Policy

## Supported versions

This is an actively developed personal project; only the latest `main` is supported.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting: go to the repository's **Security** tab →
**Report a vulnerability**. If that is unavailable, contact the maintainer privately via
[@sha-sta](https://github.com/sha-sta).

Please include steps to reproduce and the potential impact. You can expect an initial response within
a few days.

## Notes for reviewers

- Web research is **SSRF-sensitive**: `isPublicHttpUrl` blocks raw IPv6 and private ranges, and the
  fetcher uses `redirect: "error"`. Treat all fetched web content as untrusted; please don't loosen
  these guards.
- Secrets live only in environment variables (`.env.local` / Vercel), never in the repo. The service-
  role key is server-only and must never reach the client.
