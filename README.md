# Confluence Downloader

A powerful CLI tool to download and sync Confluence spaces to local markdown files, maintaining the original page hierarchy and metadata.

## Features

- 🚀 Interactive CLI for easy space management
- 📁 Maintains Confluence page hierarchy in local directory structure
- 🔄 Incremental sync with last update tracking
- 🏷️ Preserves page metadata, labels, and comments
- 📝 Converts Confluence content to clean markdown
- 🌳 Directory-based structure for pages with children
- ⚡ Concurrent processing for faster downloads
- 🔍 Fuzzy search for space selection
- 🎨 Beautiful progress bars and status updates

## Installation

```bash
# Using npm
npm install -g @jfconley/confluence-downloader

# Using pnpm
pnpm add -g @jfconley/confluence-downloader

# Using yarn
yarn global add @jfconley/confluence-downloader
```

## Quick Start

1. Create a `.env` file with your Confluence credentials:

```env
CONFLUENCE_BASE=https://your-domain.atlassian.net
CONFLUENCE_TOKEN=your-api-token
CONFLUENCE_EMAIL=your-email@domain.com
CONFLUENCE_CONFIG=./confluence.json
```

2. Initialize the library:

```bash
confluence-downloader init
```

3. Start the interactive mode:

```bash
confluence-downloader interactive
```

## Usage

### Interactive Mode

The easiest way to use the tool is through interactive mode:

```bash
confluence-downloader interactive -t <token> -b <base-url> -c <config-path>
```

This provides a menu-driven interface with the following options:
- List spaces
- Add space
- Remove space
- Sync space
- Sync all spaces
- Show configuration
- Exit

### Command Line Interface

```bash
# Initialize a new library
confluence-downloader init --baseUrl <url> --apiToken <token>

# Add a space
confluence-downloader add-space --spaceKey <key> [--localPath <path>]

# Remove a space
confluence-downloader remove-space --spaceKey <key>

# List configured spaces
confluence-downloader list-spaces

# Sync a specific space
confluence-downloader sync --spaceKey <key>

# Sync all configured spaces
confluence-downloader sync

# Show configuration
confluence-downloader show
```

### Legacy Single Space Sync

For one-off space downloads without library management:

```bash
confluence-downloader sync-space \
  --baseUrl <url> \
  --apiToken <token> \
  --spaceKey <key> \
  --outputDir <dir> \
  --email <email>
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CONFLUENCE_BASE` | Base URL of your Confluence instance |
| `CONFLUENCE_TOKEN` | Confluence API token |
| `CONFLUENCE_EMAIL` | Your Confluence account email |
| `CONFLUENCE_CONFIG` | Path to configuration file |
| `CONFLUENCE_OUTPUT_DIR` | Default output directory for spaces |

### Configuration Files

The tool maintains two types of configuration files:

1. `confluence.json` (Library configuration):
```json
{
  "baseUrl": "https://your-domain.atlassian.net",
  "spaces": [
    {
      "spaceKey": "SPACE",
      "localPath": "space-docs",
      "lastSync": "2024-01-22T12:00:00.000Z"
    }
  ]
}
```

2. `space.json` (Space metadata, one per space):
```json
{
  "key": "SPACE",
  "name": "Space Name",
  "description": "Space description",
  "lastSynced": "2024-01-22T12:00:00.000Z"
}
```

## Output Structure

The tool creates a clean, hierarchical directory structure:

```
output-dir/
├── space-1/
│   ├── space.json
│   ├── Page 1.md
│   └── Directory Page/
│       ├── description.md
│       ├── Child Page 1.md
│       └── Child Page 2.md
└── space-2/
    ├── space.json
    └── ...
```

Pages with children are saved as `description.md` inside their respective directories.

### Markdown Format

Each markdown file includes:
- YAML frontmatter with metadata
- Original Confluence content
- Comments section (if any)

Example:
```markdown
---
title: Page Title
labels:
  - label1
  - label2
author: John Doe
lastUpdated: 2024-01-22T12:00:00.000Z
confluence:
  id: 123456
  version: 5
  space: SPACE
---

# Page Title

Page content in markdown format...

---

## Comments

### Jane Smith (Jan 20, 2024)
Comment content in markdown format...
```

## Requirements

- Node.js >= 18.0.0
- A valid Confluence API token
- Confluence Cloud instance

## License

MIT 