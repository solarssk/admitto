# Admitto

Self-hosted registration-to-check-in for internal corporate events. One source of truth. No SaaS, no recurring fees.

Admitto covers everything between "we have a guest list" and "the event is over and we know who showed up": import attendees, issue each one a secure QR ticket, deliver it by email (and optionally to Apple/Google Wallet), check people in at the door, and export who actually attended.

Full documentation, source, and the deployment guide live on GitHub: **[github.com/solarssk/admitto](https://github.com/solarssk/admitto)**.

## Image

```text
solarssk/admitto:X.Y.Z      # pinned release, e.g. 0.6.7
solarssk/admitto:X.Y        # rolling minor line, e.g. 0.6
```

Multi-arch manifest (`linux/amd64` + `linux/arm64`) - Docker pulls the one matching your host automatically. Every image passes a Trivy CRITICAL-vulnerability gate before it's pushed, and the same content is also published to `ghcr.io/solarssk/admitto` if you prefer GHCR.

This image is one part of a Docker Compose stack (app, worker, PostgreSQL, Redis, nginx) - it's not meant to run standalone with `docker run`. Deploy instructions: **[deploy/README.md](https://github.com/solarssk/admitto/blob/main/deploy/README.md)**.

## Links

- [Documentation and Wiki](https://github.com/solarssk/admitto/wiki)
- [Deployment guide](https://github.com/solarssk/admitto/blob/main/deploy/README.md)
- [Security policy](https://github.com/solarssk/admitto/blob/main/SECURITY.md)
- [Changelog](https://github.com/solarssk/admitto/blob/main/CHANGELOG.md)
