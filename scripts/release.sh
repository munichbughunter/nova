#!/bin/bash

set -e

VERSION=${1:-"0.1.0"}
REPO_URL="https://github.com/munichbughunter/nova-cli"

echo "🚀 Preparing Nova CLI release v$VERSION"

# Validate version format
if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ Invalid version format. Use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

# Update version in main.ts
sed -i.bak "s/export const NOVA_VERSION = \".*\"/export const NOVA_VERSION = \"$VERSION\"/" src/main.ts

# Build binaries
echo "🔨 Building Nova CLI binaries..."
deno compile --allow-all --output nova-linux-x64 src/main.ts
deno compile --allow-all --target x86_64-apple-darwin --output nova-darwin-x64 src/main.ts
deno compile --allow-all --target aarch64-apple-darwin --output nova-darwin-arm64 src/main.ts

# Create archives
echo "📦 Creating release archives..."
tar -czf nova-linux-x64.tar.gz nova-linux-x64
tar -czf nova-darwin-x64.tar.gz nova-darwin-x64
tar -czf nova-darwin-arm64.tar.gz nova-darwin-arm64

# Generate checksums
echo "🔒 Generating SHA256 checksums..."
sha256sum nova-darwin-x64.tar.gz | cut -d' ' -f1 > darwin-x64.sha256
sha256sum nova-darwin-arm64.tar.gz | cut -d' ' -f1 > darwin-arm64.sha256
sha256sum nova-linux-x64.tar.gz | cut -d' ' -f1 > linux-x64.sha256

# Update Homebrew formula
echo "🍺 Updating Homebrew formula..."
DARWIN_X64_SHA=$(cat darwin-x64.sha256)
DARWIN_ARM64_SHA=$(cat darwin-arm64.sha256)
LINUX_X64_SHA=$(cat linux-x64.sha256)

sed -i.bak "s/version \".*\"/version \"$VERSION\"/" homebrew-nova/Formula/nova.rb
sed -i.bak "s/v[0-9]\+\.[0-9]\+\.[0-9]\+/v$VERSION/g" homebrew-nova/Formula/nova.rb
sed -i.bak "s/arm64_sha256_checksum_here/$DARWIN_ARM64_SHA/" homebrew-nova/Formula/nova.rb
sed -i.bak "s/x64_sha256_checksum_here/$DARWIN_X64_SHA/" homebrew-nova/Formula/nova.rb
sed -i.bak "s/linux_sha256_checksum_here/$LINUX_X64_SHA/" homebrew-nova/Formula/nova.rb

# Create git tag
echo "🏷️ Creating git tag..."
git add .
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

# Push to GitHub
echo "⬆️ Pushing to GitHub..."
git push origin main
git push origin "v$VERSION"

# Cleanup
rm -f *.bak *.sha256 nova-* *.tar.gz

echo "✅ Release v$VERSION prepared successfully!"
echo "📋 Next steps:"
echo "   1. GitHub Actions will automatically create the release"
echo "   2. Homebrew formula will be updated automatically"
echo "   3. Users can install with: brew install munichbughunter/nova/nova"