# 📊 Verfügbare GitLab-Funktionen in Nova

## 🎯 Übersicht

Nova verfügt über eine umfassende GitLab-Integration mit vielen Funktionen zur Verwaltung von Projekten, Merge Requests, und zur Analyse von Projekt-Metriken.

## 📂 **Projekt-Verwaltung**

### `getProjects(forceRefresh?)`
- **Zweck**: Holt alle Projekte mit Caching-Unterstützung
- **Parameter**: `forceRefresh` (optional boolean) - Cache umgehen
- **Rückgabe**: `Promise<ProjectSchema[]>`
- **Features**: 72h Cache, Membership-Filter

### `getProjectDetails(fullPath)`
- **Zweck**: Detaillierte Informationen zu einem spezifischen Projekt
- **Parameter**: `fullPath` (string) - Projekt-Pfad
- **Rückgabe**: `Promise<ProjectSchema>`

### `getRecentProjects()`
- **Zweck**: Kürzlich angesehene Projekte
- **Rückgabe**: `Promise<ProjectSchema[]>`
- **Features**: Automatisches Tracking der letzten 5 Projekte

### `getCurrentMergeRequest()`
- **Zweck**: Aktuelle Merge Request basierend auf Git-Branch
- **Rückgabe**: `Promise<GitLabMergeRequest | null>`
- **Features**: Automatische Erkennung aus Git-Repository

## 📊 **Projekt-Metriken & Analytics**

### `getProjectMetrics(fullPath, timeRange, forceRefresh?, options?)`
- **Zweck**: Umfassende Projekt-Metriken (DORA, Code Quality, Team Performance)
- **Parameter**: 
  - `fullPath` (string) - Projekt-Pfad
  - `timeRange` (TimeRange) - Zeitraum ('7d', '30d', '90d')
  - `options` (object) - MR-Limit, Pipeline-Limit, Team-Limit
- **Rückgabe**: `Promise<GitLabProjectMetrics>`
- **Features**: DORA-Metriken, Code-Qualität, Team-Performance

### `formatProjectInfo(project)`
- **Zweck**: Formatiert Projekt-Informationen für Anzeige
- **Parameter**: `project` (ProjectSchema)
- **Rückgabe**: `string` (formatierte Tabelle)

### `formatProjectMetrics(metrics)`
- **Zweck**: Formatiert umfassende Projekt-Metriken für Dashboard
- **Parameter**: `metrics` (GitLabProjectMetrics)
- **Rückgabe**: `string` (formatiertes Dashboard)

## 🔀 **Merge Request Operationen**

### Basis-Operationen
#### `getProjectMergeRequests(projectPath, timeRange, limit?)`
- **Zweck**: Holt Merge Requests für ein Projekt
- **Parameter**: 
  - `projectPath` (string)
  - `timeRange` (TimeRange)
  - `limit` (number, default: 100)
- **Rückgabe**: `Promise<GitLabMergeRequest[]>`

#### `getMergeRequest(projectPath, mrIid)`
- **Zweck**: Detaillierte Informationen zu einer spezifischen MR
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
- **Rückgabe**: `Promise<GitLabMergeRequest>`

#### `createMergeRequest(projectPath, options)`
- **Zweck**: Erstellt eine neue Merge Request
- **Parameter**: 
  - `projectPath` (string)
  - `options` (object): sourceBranch, targetBranch, title, description, draft?
- **Rückgabe**: `Promise<GitLabMergeRequest>`

### 🆕 **Advanced Merge Request Operations (Schritt 1)**

#### `updateMergeRequest(projectPath, mrIid, updates)` ✨
- **Zweck**: Aktualisiert eine bestehende Merge Request
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `updates` (object): title?, description?, target_branch?, state_event?, remove_source_branch?, allow_collaboration?, draft?, assignee_ids?, reviewer_ids?, labels?
- **Rückgabe**: `Promise<GitLabMergeRequest>`
- **API**: REST API (PUT)

#### `getMergeRequestDiffs(projectPath, mrIid, view?)` ✨
- **Zweck**: Holt Diffs/Änderungen einer Merge Request
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `view` ('inline' | 'parallel', default: 'inline')
- **Rückgabe**: `Promise<GitLabChange[]>`
- **API**: REST API mit View-Optionen

#### `listMergeRequestDiscussions(projectPath, mrIid)` ✨
- **Zweck**: Listet alle Diskussionen/Kommentare einer MR
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
- **Rückgabe**: `Promise<GitLabDiscussion[]>`
- **API**: GraphQL API (optimiert)

### Kommentar-Operationen
#### `createMergeRequestComment(projectPath, mrIid, comment, isDraft?)`
- **Zweck**: Erstellt einen Kommentar zu einer MR
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `comment` (string)
  - `isDraft` (boolean, default: false)
- **Rückgabe**: `Promise<void>`

#### `getMergeRequestChanges(projectPath, mrIid)`
- **Zweck**: Legacy-Funktion für MR-Änderungen (verwendet jetzt `getMergeRequestDiffs`)
- **Rückgabe**: `Promise<GitLabChange[]>`

#### `createMergeRequestDiffComment(projectPath, mrIid, body, position)` 🆕
- **Zweck**: Fügt Kommentar zu spezifischer Diff-Zeile hinzu
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `body` (string)
  - `position` (GitLabDiffPosition)
- **Rückgabe**: `Promise<GitLabDiscussion>`
- **API**: REST API (POST discussions)

#### `addMergeRequestDiscussionReply(projectPath, mrIid, discussionId, body)` 🆕
- **Zweck**: Fügt Antwort zu Diskussions-Thread hinzu
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `discussionId` (string)
  - `body` (string)
- **Rückgabe**: `Promise<GitLabNote>`
- **API**: REST API (POST notes)

#### `resolveMergeRequestDiscussion(projectPath, mrIid, discussionId, resolved)` 🆕
- **Zweck**: Markiert Diskussion als gelöst/ungelöst
- **Parameter**: 
  - `projectPath` (string)
  - `mrIid` (number)
  - `discussionId` (string)
  - `resolved` (boolean)
- **Rückgabe**: `Promise<GitLabDiscussion>`
- **API**: REST API (PUT discussion)

## 🛠️ **Hilfs-Funktionen & Formatierung**

### Cache-Verwaltung
#### `clearCache(pattern?)`
- **Zweck**: Löscht GitLab-Cache
- **Parameter**: `pattern` (optional string) - Cache-Pattern zum Löschen

## 🎯 **Code-Qualität & Dokumentation**

### Interne Analyse-Funktionen
- `getProjectCodeQuality()` - Code-Qualitäts-Metriken
- `checkDocumentation()` - Dokumentations-Vollständigkeit
- `calculateDeploymentFrequency()` - DORA Deployment Frequency
- `getTeamMetrics()` - Team-Performance-Metriken
- `getProjectPipelineMetrics()` - Pipeline-Erfolgsraten

## 📈 **Metriken & Analysen**

### DORA-Metriken
- ✅ **Deployment Frequency** - Automatische Erkennung von Production/Staging/Dev
- ✅ **Lead Time for Changes** - Basierend auf MR-Zeiten
- ✅ **Change Failure Rate** - Pipeline-Erfolgsraten
- ✅ **Time to Restore** - Incident-Recovery-Metriken

### Code-Qualität
- ✅ **Coverage-Analyse** - Automatische Test-Coverage-Erkennung
- ✅ **Tool-Erkennung** - AI Review, Load Testing, Renovate, Secret Scanning
- ✅ **Dokumentations-Health** - README, Contributing, License, etc.
- ✅ **Framework-Erkennung** - Package.json, Dockerfile, etc.

### Team-Performance
- ✅ **Review Participation** - Prozentsatz der reviewenden Team-Mitglieder
- ✅ **Time to Merge** - Durchschnittliche Merge-Zeit
- ✅ **Time to First Review** - Durchschnittliche Zeit bis zur ersten Review
- ✅ **Top Contributors** - Ranking nach Aktivität

## 🔧 **API-Integration**

### REST API
- Projekt-Erstellung/-Updates
- MR-Updates
- Diff-Abruf mit View-Optionen
- File-Operations

### GraphQL API
- Optimierte Metriken-Abfragen
- Team-Analytics
- Diskussions-Abruf
- Pipeline-Metriken

## 🚀 **Leistungsmerkmale**

### Caching
- ✅ **Multi-Layer Cache** - DevCache mit Query-Type-basierter Strategie
- ✅ **User Cache** - Für Projekte und Benutzer-spezifische Daten
- ✅ **72h Cache** für Projekt-Listen
- ✅ **Smart Cache Invalidation**

### Error Handling
- ✅ **Umfassendes Error Handling** mit aussagekräftigen Meldungen
- ✅ **Structured Logging** mit Debug-Unterstützung
- ✅ **Graceful Fallbacks** bei API-Fehlern

### TypeScript Integration
- ✅ **Vollständige TypeScript-Typisierung**
- ✅ **Interface-basierte API-Responses**
- ✅ **Type-Safe Konfiguration**

## ❌ **Noch nicht implementiert (aber geplant)**

Basierend auf dem dev-kit Repository fehlen noch:

### Repository-Operationen
- `createRepository()` - Neue GitLab-Projekte erstellen
- `forkRepository()` - Projekte forken
- `searchRepositories()` - Projekt-Suche

### File-Operationen
- `createOrUpdateFile()` - Einzelne Dateien erstellen/aktualisieren
- `pushFiles()` - Multiple Dateien in einem Commit
- `getFileContents()` - Datei-Inhalte abrufen

### Issue-Management
- `createIssue()` - Issues erstellen
- `getIssue()` - Issue-Details
- `updateIssue()` - Issues aktualisieren

### Branch-Operationen
- `createBranch()` - Neue Branches erstellen
- `deleteBranch()` - Branches löschen
- `getBranches()` - Branch-Liste

### Label-Management
- `listLabels()` - Labels auflisten
- `createLabel()` - Labels erstellen
- `updateLabel()` - Labels aktualisieren
- `deleteLabel()` - Labels löschen

### Erweiterte MR-Operationen
- `createNote()` - Allgemeine Notiz-Erstellung
- `updateMergeRequestNote()` - MR-Notizen bearbeiten
- `resolveMergeRequestDiscussion()` - Diskussionen als gelöst markieren

## 🎯 **Fazit**

Nova verfügt bereits über eine sehr umfassende GitLab-Integration mit:

- ✅ **14 öffentliche Funktionen** für verschiedene GitLab-Operationen
- ✅ **Advanced Analytics** mit DORA-Metriken und Team-Performance
- ✅ **Moderne API-Integration** (REST + GraphQL)
- ✅ **Enterprise-ready Features** (Caching, Error Handling, TypeScript)
- ✅ **User Experience** (Formatierte Ausgaben, Dashboard-Views)

**Der nächste Schritt wäre die Implementation der fehlenden Repository-, File- und Issue-Operationen aus dem dev-kit.**
