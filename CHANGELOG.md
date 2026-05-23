# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-23

### Added

- Central `VERSION` file and `Directory.Build.props` for .NET assembly versioning.
- Release branch workflow (`release/*`) and version bump scripts.

### Changed

- Frontend and Docker env defaults use `localhost` API URLs for local development.
- Docker Compose sets separate `API_URL` / `NEXT_PUBLIC_API_URL` for in-network vs browser calls.
- `car-makes-icons` installed from npm registry (fixes missing `dist/style.css` and Docker SSH builds).
- Session middleware clears invalid cookies after secret rotation.

### Fixed

- Login failures when running the frontend outside Docker (`ENOTFOUND api`).
- Frontend Docker build failing on `git+ssh` dependency resolution.

[1.0.0]: https://github.com/rene98c/carcareco/compare/v0.1.0...v1.0.0
