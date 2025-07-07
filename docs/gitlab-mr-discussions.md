# Advanced Merge Request Discussion Operations - Erweiterung Schritt 1

## 🆕 Neue Funktionen implementiert

### 1. `createMergeRequestDiffComment(projectPath, mrIid, body, position)`

**Zweck**: Fügt einen Kommentar zu einer spezifischen Zeile in einem Merge Request Diff hinzu.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request
- `body` (string): Der Kommentartext
- `position` (GitLabDiffPosition): Die Position im Diff
  - `base_sha` (string): Base commit SHA
  - `start_sha` (string): Start commit SHA  
  - `head_sha` (string): Head commit SHA
  - `old_path?` (string): Alter Dateipfad (bei umbenannten Dateien)
  - `new_path` (string): Neuer Dateipfad
  - `old_line?` (number): Zeilennummer in der alten Datei
  - `new_line?` (number): Zeilennummer in der neuen Datei
  - `line_range?` (object): Für Multi-Line-Kommentare

**Rückgabe**: `Promise<GitLabDiscussion>` - Die erstellte Diskussion

**Verwendung**:
```typescript
const discussion = await gitlabService.createMergeRequestDiffComment(
    'namespace/project',
    123,
    'Diese Zeile sollte überprüft werden.',
    {
        base_sha: 'abc123',
        start_sha: 'def456',
        head_sha: 'ghi789',
        new_path: 'src/service.ts',
        new_line: 42
    }
);
```

### 2. `addMergeRequestDiscussionReply(projectPath, mrIid, discussionId, body)`

**Zweck**: Fügt eine Antwort zu einem bestehenden Diskussions-Thread hinzu.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request
- `discussionId` (string): Die ID des Diskussions-Threads
- `body` (string): Der Antworttext

**Rückgabe**: `Promise<GitLabNote>` - Die erstellte Notiz

**Verwendung**:
```typescript
const note = await gitlabService.addMergeRequestDiscussionReply(
    'namespace/project',
    123,
    'discussion_id_123',
    'Gute Beobachtung! Ich werde das ändern.'
);
```

### 3. `resolveMergeRequestDiscussion(projectPath, mrIid, discussionId, resolved)`

**Zweck**: Markiert eine Diskussion als gelöst oder ungelöst.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request
- `discussionId` (string): Die ID des Diskussions-Threads
- `resolved` (boolean): true = lösen, false = wieder öffnen

**Rückgabe**: `Promise<GitLabDiscussion>` - Die aktualisierte Diskussion

**Verwendung**:
```typescript
const discussion = await gitlabService.resolveMergeRequestDiscussion(
    'namespace/project',
    123,
    'discussion_id_123',
    true
);
```

## 🎯 **Neue Interface-Definition**

### `GitLabDiffPosition`
```typescript
interface GitLabDiffPosition {
  base_sha: string;
  start_sha: string;
  head_sha: string;
  old_path?: string;
  new_path: string;
  old_line?: number;
  new_line?: number;
  line_range?: {
    start: {
      line_code: string;
      type: 'new' | 'old';
      old_line?: number;
      new_line?: number;
    };
    end: {
      line_code: string;
      type: 'new' | 'old';
      old_line?: number;
      new_line?: number;
    };
  };
}
```

## 🔧 **API-Integration**

Alle neuen Funktionen verwenden die **GitLab REST API**:
- **createMergeRequestDiffComment**: `POST /projects/:id/merge_requests/:merge_request_iid/discussions`
- **addMergeRequestDiscussionReply**: `POST /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id/notes`
- **resolveMergeRequestDiscussion**: `PUT /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id`

## 💡 **Anwendungsfälle**

### Code Review Workflow
```typescript
// 1. Diff-Kommentar zu einer problematischen Zeile hinzufügen
const discussion = await gitlabService.createMergeRequestDiffComment(
    'myteam/myproject',
    456,
    'Diese Funktion sollte validierte Parameter verwenden.',
    {
        base_sha: mr.diff_refs.base_sha,
        start_sha: mr.diff_refs.start_sha,
        head_sha: mr.diff_refs.head_sha,
        new_path: 'src/user-service.ts',
        new_line: 38
    }
);

// 2. Entwickler antwortet auf den Kommentar
const reply = await gitlabService.addMergeRequestDiscussionReply(
    'myteam/myproject',
    456,
    discussion.id,
    'Guter Punkt! Ich füge die Validierung hinzu.'
);

// 3. Nach der Änderung wird die Diskussion als gelöst markiert
await gitlabService.resolveMergeRequestDiscussion(
    'myteam/myproject',
    456,
    discussion.id,
    true
);
```

### Automatisierte Code-Analyse
```typescript
// Automatisch Kommentare zu bestimmten Code-Patterns hinzufügen
const diffs = await gitlabService.getMergeRequestDiffs('project', 123);

for (const change of diffs) {
    const lines = change.diff.split('\n');
    lines.forEach((line, index) => {
        if (line.includes('console.log') && line.startsWith('+')) {
            // Kommentar zu Debug-Ausgaben hinzufügen
            await gitlabService.createMergeRequestDiffComment(
                'project',
                123,
                '⚠️ Debug-Ausgabe sollte vor dem Merge entfernt werden.',
                {
                    // ... position details
                    new_line: index + 1
                }
            );
        }
    });
}
```

## ✅ **Vorteile der neuen Funktionen**

1. **Präzise Code-Reviews** - Kommentare direkt an spezifischen Code-Zeilen
2. **Thread-Management** - Diskussionen können verfolgt und aufgelöst werden
3. **Automatisierung** - Basis für automatisierte Code-Review-Tools
4. **Vollständige GitLab-Integration** - Nahtlose Nutzung der GitLab-Features

## 📋 **Vollständige MR-Operations Übersicht**

**Nova verfügt jetzt über folgende MR-Funktionen:**

### Basis-Operationen
- ✅ `getProjectMergeRequests()` - MR-Liste abrufen
- ✅ `getMergeRequest()` - Einzelne MR-Details
- ✅ `createMergeRequest()` - Neue MR erstellen
- ✅ `updateMergeRequest()` - MR aktualisieren
- ✅ `getCurrentMergeRequest()` - Aktuelle MR basierend auf Git-Branch

### Diff-Operationen
- ✅ `getMergeRequestDiffs()` - Diffs mit View-Optionen
- ✅ `getMergeRequestChanges()` - Legacy-Funktion für Änderungen

### Diskussions-Operationen
- ✅ `listMergeRequestDiscussions()` - Alle Diskussionen auflisten
- ✅ `createMergeRequestComment()` - Einfacher MR-Kommentar
- 🆕 `createMergeRequestDiffComment()` - **Diff-spezifischer Kommentar**
- 🆕 `addMergeRequestDiscussionReply()` - **Antwort zu Thread**
- 🆕 `resolveMergeRequestDiscussion()` - **Diskussion lösen/öffnen**

---

**🎉 Nova hat jetzt eine vollständige und mächtige GitLab Merge Request Integration!**
