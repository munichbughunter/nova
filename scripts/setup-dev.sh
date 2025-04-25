#!/bin/bash
set -x  # Enable debug mode

echo "Setting up Nova development environment..."

# Create completions directory
COMPLETIONS_DIR="${HOME}/.zsh/completions"
echo "Creating completions directory: ${COMPLETIONS_DIR}"
mkdir -p "${COMPLETIONS_DIR}"

# Generate completions for both production and development
echo "Generating completions..."
deno task completions zsh > "${COMPLETIONS_DIR}/_nova"

# Create development completions by modifying the function name and command
echo "Creating development completions..."
sed "s/_nova/_novad/g" "${COMPLETIONS_DIR}/_nova" > "${COMPLETIONS_DIR}/_novad"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Configuring for macOS..."
  sed -i '' 's/compdef _novad nova/compdef _novad novad/' "${COMPLETIONS_DIR}/_novad"
else
  echo "Configuring for Linux..."
  sed -i 's/compdef _novad nova/compdef _novad novad/' "${COMPLETIONS_DIR}/_novad"
fi

# Clean up any existing Nova config in .zshrc
echo "Cleaning up existing configuration..."
if grep -q "# Nova configuration - START" ~/.zshrc; then
  sed -i.bak '/# Nova configuration - START/,/# Nova configuration - END/d' ~/.zshrc
fi

# Create wrapper script
echo "Creating wrapper script..."
WRAPPER_SCRIPT="${HOME}/.local/bin/novad"
mkdir -p "$(dirname "$WRAPPER_SCRIPT")"

cat > "$WRAPPER_SCRIPT" << 'EOL'
#!/bin/bash
# Get the project directory from the first argument or use current directory
PROJECT_DIR="${1:-$(pwd)}"
cd "$PROJECT_DIR" && NOVA_DEBUG=true deno task start "${@:2}"
EOL

chmod +x "$WRAPPER_SCRIPT"

# Update .zshrc with both alias and wrapper support
cat >> ~/.zshrc << 'EOL'

# Nova configuration - START
# Add completions directory to fpath if not already there
if [[ ":$FPATH:" != *":$HOME/.zsh/completions:"* ]]; then
  export FPATH="${HOME}/.zsh/completions:${FPATH}"
fi

# Development aliases
if [ -f "$(pwd)/deno.json" ]; then
  # If in a Deno project directory, use local version
  alias novad='NOVA_DEBUG=true deno task start'
else
  # Otherwise use the wrapper script
  alias novad='~/.local/bin/novad $(pwd)'
fi

# Production alias (when installed)
alias nova='~/.local/bin/nova'

# Ensure completions are loaded
autoload -Uz compinit
compinit -u

# Explicitly load completion functions
autoload -Uz _nova
autoload -Uz _novad

# Register completions
compdef _nova nova
compdef _novad novad
# Nova configuration - END
EOL

# Force reload completions
echo "Reloading completions..."
autoload -Uz compinit
compinit -u

echo "Current FPATH:"
echo $FPATH

echo "Completion files:"
ls -la "${COMPLETIONS_DIR}"/_nova*

echo "Completion function contents:"
echo "=== _nova ==="
cat "${COMPLETIONS_DIR}/_nova" | head -n 10
echo "=== _novad ==="
cat "${COMPLETIONS_DIR}/_novad" | head -n 10

echo "✨ Development environment setup complete!"
echo "Please run: exec zsh"  # This is better than source ~/.zshrc 