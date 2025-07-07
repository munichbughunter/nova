# Advanced Merge Request Operations - Schritt 1

## Implementiert in diesem Schritt

### 1. `updateMergeRequest(projectPath, mrIid, updates)`

**Zweck**: Aktualisiert eine bestehende Merge Request mit neuen Werten.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request
- `updates` (object): Objekt mit den zu aktualisierenden Feldern:
  - `title?` (string): Neuer Titel
  - `description?` (string): Neue Beschreibung
  - `target_branch?` (string): Neuer Ziel-Branch
  - `state_event?` ('close' | 'reopen'): Status-Änderung
  - `remove_source_branch?` (boolean): Source-Branch nach Merge entfernen
  - `allow_collaboration?` (boolean): Kollaboration erlauben
  - `draft?` (boolean): Als Draft markieren
  - `assignee_ids?` (number[]): Zugewiesene Benutzer-IDs
  - `reviewer_ids?` (number[]): Reviewer-IDs
  - `labels?` (string): Labels als String

**Rückgabe**: `Promise<GitLabMergeRequest>` - Die aktualisierte Merge Request

**Verwendung**:
```typescript
const updatedMR = await gitlabService.updateMergeRequest(
    'namespace/project',
    123,
    {
        title: 'Neuer Titel',
        description: 'Neue Beschreibung',
        draft: false
    }
);
```

### 2. `getMergeRequestDiffs(projectPath, mrIid, view?)`

**Zweck**: Holt die Diffs/Änderungen einer Merge Request mit optionalem View-Format.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request
- `view?` ('inline' | 'parallel'): Diff-Ansichtstyp (Standard: 'inline')

**Rückgabe**: `Promise<GitLabChange[]>` - Array der Änderungen

**Verwendung**:
```typescript
const diffs = await gitlabService.getMergeRequestDiffs(
    'namespace/project',
    123,
    'parallel'
);
```

### 3. `listMergeRequestDiscussions(projectPath, mrIid)`

**Zweck**: Listet alle Diskussionen/Kommentare einer Merge Request auf.

**Parameter**:
- `projectPath` (string): Der Pfad zum Projekt (namespace/project_name)
- `mrIid` (number): Die interne ID der Merge Request

**Rückgabe**: `Promise<GitLabDiscussion[]>` - Array der Diskussionen

**Verwendung**:
```typescript
const discussions = await gitlabService.listMergeRequestDiscussions(
    'namespace/project',
    123
);
```

## API-Implementierung

- **updateMergeRequest**: Verwendet die GitLab REST API (PUT /projects/:id/merge_requests/:merge_request_iid)
- **getMergeRequestDiffs**: Verwendet die GitLab REST API (GET /projects/:id/merge_requests/:merge_request_iid/changes)
- **listMergeRequestDiscussions**: Verwendet die GitLab GraphQL API für optimierte Abfragen

## Fehlerbehandlung

Alle Funktionen implementieren umfassendes Error Handling mit:
- Logging von Debug-Informationen
- Aussagekräftige Fehlermeldungen
- Proper Exception Propagation

## Integration in bestehende Codebase

Die neuen Funktionen folgen den etablierten Mustern der `GitLabService` Klasse:
- ✅ Verwendung von `ensureInitialized()`
- ✅ Strukturiertes Logging
- ✅ TypeScript-Typisierung
- ✅ Konsistente Error Handling
- ✅ API Response Transformation

## Nächste Schritte

Bereit für Schritt 2: Weitere GitLab-Operationen aus dem dev-kit Repository.
