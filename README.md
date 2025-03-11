# Confluence Downloader

A command-line tool for downloading Confluence spaces and storing them in a SQLite database for further processing.

## Features

- ✅ Download Confluence spaces to SQLite databases
- ✅ Preserve content structure, relationships, and metadata
- ✅ Centralized application and space configuration
- ✅ Interactive mode for easy usage
- ✅ Support for comments and folders
- ✅ Batched content downloading with progress reporting

## Installation

```bash
npm install -g @jfconley/confluence-downloader
```

Or use it directly with npx:

```bash
npx @jfconley/confluence-downloader <command>
```

## Usage

### Quick Start

1. Initialize the database and configuration:
   ```bash
   confluence-downloader init
   ```

2. Add a Confluence space:
   ```bash
   confluence-downloader spaces add --spaceKey YOUR_SPACE_KEY
   ```

3. Download content:
   ```bash
   confluence-downloader download --spaceKey YOUR_SPACE_KEY
   ```

### Interactive Mode

For an easier, guided experience:

```bash
confluence-downloader interactive
```

This provides a menu-driven interface for all operations.

## CLI Commands

### Initialize Configuration

```bash
confluence-downloader init
```

Creates and initializes the SQLite database with basic settings, prompting for:
- Confluence base URL
- API token
- Concurrency level

### Settings Management

```bash
# List all settings
confluence-downloader settings list

# Get a specific setting
confluence-downloader settings get --key baseUrl

# Set a setting value
confluence-downloader settings set --key baseUrl --value "https://your-instance.atlassian.net"

# Remove a setting
confluence-downloader settings remove --key customSetting
```

### Space Management

```bash
# List configured spaces
confluence-downloader spaces list

# Add a space (interactive)
confluence-downloader spaces add

# Add a specific space
confluence-downloader spaces add --spaceKey DOCS --output ./docs

# Remove a space
confluence-downloader spaces remove --spaceKey DOCS
```

### Content Download

```bash
# Download a space's content to the database
confluence-downloader download --spaceKey DOCS
```

## Database Schema

The SQLite database uses the following structure:

### `settings` Table
Stores application-wide settings as key-value pairs:
- `key` - Setting name (primary key)
- `value` - Setting value

### `spaces` Table
Stores Confluence space configurations:
- `id` - Space ID (primary key)
- `key` - Space key (unique)
- `name` - Space name
- `description` - Space description
- `local_path` - Local path for content
- `base_url` - Confluence instance URL
- `last_synced` - Last sync timestamp
- `enabled` - Whether the space is enabled
- `status` - Space status

### `pages` Table
Stores Confluence pages:
- `id` - Page ID (primary key)
- `space_key` - Space key
- `title` - Page title
- `status` - Page status
- `body_storage` - HTML content
- `body_atlas_doc_format` - ADF content
- Other metadata fields

### `comments` Table
Stores page comments:
- `id` - Comment ID (primary key)
- `space_key` - Space key
- `container_id` - Parent page ID
- `comment_type` - 'inline' or 'footer'
- Reference and content fields

### `folders` Table
Stores Confluence folders:
- `id` - Folder ID (primary key)
- `space_key` - Space key
- `title` - Folder title
- Metadata fields

### `ancestors` Table
Stores parent-child relationships:
- `id` - Content ID
- `ancestor_id` - Ancestor ID
- `position` - Position in ancestor chain

### `labels` Table
Stores content labels:
- `content_id` - Content ID
- `label_name` - Label name

## Configuration

Default database location: `~/.local/share/confluence-downloader/confluence.db`

Override with `--dbPath` option:

```bash
confluence-downloader --dbPath /custom/path/confluence.db spaces list
```

## Environment Variables

- `CONFLUENCE_API_TOKEN` - Confluence API token
- `CONFLUENCE_EMAIL` - Confluence account email

## License

MIT 