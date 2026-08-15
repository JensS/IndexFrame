# Unofficial `.library` interoperability notes

Observed with Eagle 4.0.0. This document is an incomplete, independent description of the file format based on user-owned libraries and synthetic fixtures. It is provided solely to support interoperability. It is not an official specification and includes no Eagle source code, logos, or bundled media.

## Overview

Eagle is a multimedia asset management application for macOS and Windows. It stores libraries in a self-contained folder structure with the extension `.library`. The format is file-based and JSON-heavy, making it suitable for cloud synchronization.

---

## Library Root Structure

```
{LibraryName}.library/
├── metadata.json          # Library metadata (folders, smart folders, settings)
├── tags.json              # Tag history and starred tags
├── actions.json           # Custom actions (typically empty array)
├── saved-filters.json     # Saved search filters (typically empty array)
├── mtime.json             # Modification time index for all items
├── backup/                # Timestamped metadata backups
│   └── backup-{timestamp}.json
├── images/                # Item storage (despite name, holds all media types)
│   └── {ITEM_ID}.info/
│       ├── metadata.json
│       ├── {filename}.{ext}
│       └── {filename}_thumbnail.png (optional)
└── Icon                   # macOS folder icon (0 bytes marker)
```

---

## ID Format

Eagle uses 13-character alphanumeric IDs for all entities (items, folders, smart folders, tag groups).

**Pattern:** `[A-Z0-9]{13}` (Base36-like, uppercase letters and digits)

**Examples:**
- `LYSRPTK227KY3` (item)
- `ME877E6URLA1P` (folder)
- `M3CXEU0WY6QV9` (smart folder)

The first character appears to encode creation timeframe (older items start with `L`, newer with `M`).

---

## Library Metadata (`metadata.json`)

```json
{
  "folders": [Folder],
  "smartFolders": [SmartFolder],
  "quickAccess": [string],        // Item IDs for quick access
  "tagsGroups": [TagGroup],
  "modificationTime": number,     // Unix timestamp in milliseconds
  "applicationVersion": "4.0.0"
}
```

### Folder Object

```json
{
  "id": "ME877E6URLA1P",
  "name": "Folder Name",
  "description": "",
  "children": [Folder],           // Nested folders
  "modificationTime": 1754982394518,
  "tags": [],                     // Tags applied to folder
  "password": "",                 // Folder protection
  "passwordTips": ""
}
```

### SmartFolder Object

Smart folders are dynamic views based on filter conditions.

```json
{
  "id": "M3CXEU0WY6QV9",
  "name": "Smart Folder Name",
  "description": "",
  "modificationTime": 1731324162765,
  "conditions": [Condition],
  "children": []
}
```

### Condition Object

```json
{
  "rules": [Rule],
  "match": "OR" | "AND",
  "boolean": "TRUE" | "FALSE",
  "$$hashKey": "object:XXXXX"     // AngularJS internal (can be ignored)
}
```

### Rule Object

```json
{
  "property": "tags" | "name" | "ext" | "annotation" | ...,
  "method": "intersection" | "union" | "contain" | "equal" | ...,
  "value": string | [string],
  "$$hashKey": "object:XXXXX"
}
```

**Properties:**
- `tags` - Item tags
- `name` - Item name
- `ext` - File extension
- `annotation` - Description/notes
- `url` - Source URL
- `width`, `height` - Dimensions
- `rating` - Star rating

**Methods:**
- `intersection` - All values must match
- `union` - Any value matches
- `contain` - Contains substring
- `equal` - Exact match
- `greater`, `less` - Numeric comparison

### TagGroup Object

```json
{
  "id": "M3BH120HUUXAM",
  "name": "Group Name",
  "tags": ["tag1", "tag2"]
}
```

---

## Tags Metadata (`tags.json`)

```json
{
  "historyTags": ["recently", "used", "tags"],
  "starredTags": ["favorite", "tags"]
}
```

---

## Modification Time Index (`mtime.json`)

A flat key-value map of item IDs to their last modification timestamps.

```json
{
  "LYSRPTK227KY3": 1731324446713,
  "LYSRPTK22PRNN": 1731259816651,
  ...
}
```

**Purpose:** Enables efficient sync by quickly identifying changed items without reading each item's metadata.

---

## Item Storage (`images/{ID}.info/`)

Each item is stored in its own folder named `{ITEM_ID}.info`.

### Contents

| File | Description |
|------|-------------|
| `metadata.json` | Item metadata |
| `{name}.{ext}` | Original file |
| `{name}_thumbnail.png` | Generated thumbnail (optional) |

### Item Metadata

```json
{
  "id": "LYSRPTK227KY3",
  "name": "Display Name",
  "size": 1076099,                    // File size in bytes
  "btime": 1676305002050,             // Birth/creation time (ms)
  "mtime": 1676305002052,             // File modification time (ms)
  "ext": "jpg",                       // File extension (lowercase)
  "tags": ["tag1", "tag2"],
  "folders": ["FOLDER_ID"],           // Folder assignments
  "isDeleted": false,
  "url": "https://source.url",        // Source URL (optional)
  "annotation": "# Markdown notes",   // Description (Markdown)
  "modificationTime": 1731259816449,  // Metadata mod time (ms)
  "height": 3736,
  "width": 2500,
  "lastModified": 1734001755776,      // Last change timestamp (ms)
  "palettes": [ColorPalette],
  "noThumbnail": true,                // If thumbnail wasn't generated
  "ocr": OCRData,                     // OCR results (optional)
  "detection": DetectionData          // Object detection (optional)
}
```

### Video-Specific Fields

```json
{
  "duration": 16.158231,              // Duration in seconds
  "resolutionWidth": 1016,
  "resolutionHeight": 718
}
```

### Deleted Item Fields

```json
{
  "isDeleted": true,
  "deletedTime": 1765218917545        // When item was deleted
}
```

### ColorPalette Object

```json
{
  "color": [130, 97, 64],             // RGB values
  "ratio": 43                         // Percentage of image
}
```

### OCR Data

```json
{
  "done": "",                         // Processing status
  "text": "Extracted text content"
}
```

### Detection Data

```json
{
  "done": "",
  "objects": []                       // Detected objects
}
```

---

## Supported File Types

Based on library analysis:

| Category | Extensions |
|----------|-----------|
| Images | `jpg`, `png`, `webp`, `gif`, `avif`, `heic`, `svg` |
| Video | `mp4`, `webm`, `mkv`, `mov` |
| Links | `url` (Windows), `inetloc` (macOS) |
| Documents | `html` |

### URL File Format (Windows `.url`)

```ini
[InternetShortcut]
URL=https://example.com
```

### Internet Location (macOS `.inetloc`)

Binary plist or XML format containing the URL.

---

## Backup System

Eagle creates periodic backups of library metadata in the `backup/` folder.

**Filename format:** `backup-{YYYY-MM-DD HH.mm.ss.SSS}.json`

**Content:** Snapshot of `metadata.json` (folders, smart folders, settings)

**Note:** Backups do NOT include individual item metadata or files.

---

## Synchronization Model

### Design Philosophy

Eagle's format is designed for file-based cloud sync (iCloud, Dropbox, Google Drive, etc.):

1. **Self-contained items**: Each item is isolated in its own folder
2. **Flat item storage**: All items live directly under `images/` (no nesting)
3. **Minimal central state**: Library metadata is separate from item data
4. **Modification tracking**: `mtime.json` enables quick change detection

### Sync Strategy

1. **Detect changes**: Compare `mtime.json` entries
2. **Resolve conflicts**:
   - Item metadata: Use `modificationTime` field
   - Library metadata: Use `modificationTime` at root level
3. **Merge folders**: Folder structures should be merged, not replaced
4. **Handle deletions**: `isDeleted` flag with `deletedTime` for soft deletes

### Conflict Resolution

| Scenario | Resolution |
|----------|------------|
| Same item modified on two devices | Higher `modificationTime` wins |
| Item deleted on one device, modified on another | Prefer modification (restore) |
| Folder renamed differently | Manual resolution needed |

### Implementation Notes

- Never overwrite entire `metadata.json` - merge changes
- `mtime.json` should be regenerated from item folders if corrupted
- Backup files are append-only (never deleted by sync)
- Deleted items remain in `images/` until permanent purge

---

## Implementing a Parser

### Minimal Read-Only Parser

```
1. Read metadata.json
   - Parse folders array for folder tree
   - Parse smartFolders for dynamic views

2. Enumerate images/*.info directories
   - Read metadata.json from each
   - Build item index

3. Build relationships
   - Map items to folders via folders[] field
   - Evaluate smart folder conditions against items
```

### Full Parser Requirements

1. **ID Generation**: Implement 13-char ID generator
2. **Thumbnail Generation**: Create PNG thumbnails for images/videos
3. **Color Palette Extraction**: Analyze images for dominant colors
4. **mtime.json Management**: Update on every item change
5. **Backup Creation**: Periodic snapshots of metadata.json
6. **Smart Folder Evaluation**: Query engine for conditions

### Thumbnail Naming

Format: `{original_name}_thumbnail.png`

Location: Same folder as original file

Recommended size: ~200-400px on longest edge

---

## Known Limitations

1. **No incremental sync protocol**: Relies on filesystem-level sync
2. **No locking mechanism**: Concurrent edits may conflict
3. **Flat ID namespace**: All IDs share same pool
4. **AngularJS artifacts**: `$$hashKey` fields appear in conditions
5. **Large libraries**: `mtime.json` grows linearly with items

---

## Version History

| Eagle Version | Notable Changes |
|---------------|-----------------|
| 4.0.0 | Current documented version |

---

## Reference

- [Eagle](https://eagle.cool/), the desktop application that creates `.library` directories
