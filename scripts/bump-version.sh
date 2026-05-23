#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <major.minor.patch>" >&2
  exit 1
fi

VERSION="$1"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver (e.g. 1.0.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

printf '%s' "$VERSION" > "$ROOT/VERSION"

node -e "
const fs = require('fs');
const path = require('path');
const pkgPath = path.join('$ROOT', 'frontend/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

echo "Version set to $VERSION"
echo "  VERSION"
echo "  frontend/package.json"
echo ""
echo "Next steps:"
echo "  git checkout -b release/$VERSION"
echo "  dotnet build backend/src/Carmasters.sln"
echo "  cd frontend && npm install"
echo "  git commit -am \"chore: release $VERSION\""
echo "  git tag v$VERSION"
