#!/bin/bash

set -e

VERSION=${1:-"0.2.0"}
REPO_URL="https://github.com/munichbughunter/nova"

echo "🚀 Preparing Nova CLI release v$VERSION"

# Validate version format
if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ Invalid version format. Use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

# Update version in version.ts
sed -i.bak "s/export const NOVA_VERSION = \".*\"/export const NOVA_VERSION = \"$VERSION\"/" src/version.ts

# Create git tag
echo "🏷️ Creating git tag..."
git add .
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

# Push to GitHub
echo "⬆️ Pushing to GitHub..."
git push origin main
git push origin "v$VERSION"

echo "✅ Release v$VERSION prepared successfully!"
echo "📋 Next steps:"
echo "   1. GitHub Actions will automatically create the release"
echo "   2. Homebrew formula will be updated automatically"
echo "   3. Users can install with: brew install munichbughunter/nova/nova"