

```
sequenceDiagram
    participant Website as 🌐 Website (Client)
    participant API as 🛠️ API Server
    participant Nova as 🖥️ Nova CLI (Agent)

    Website->>API: Request available agents<br/>/agents
    API->>Website: Return agent list

    Website->>API: Start test workflow<br/>/runs/start
    API->>Nova: 🔄 via WebSocket: Run workflow (payload)
    Nova-->>API: ✅ Send results back via WebSocket

    API->>Website: Push or respond with test results<br/>/runs/:id
    Website->>API: Request stats<br/>/stats
    API-->>Website: Return stats
```

Overview

```
flowchart TD
    subgraph CLI_Layer
        Nova["<b>🖥️ Nova CLI Agent</b>"]
    end

    subgraph Frontend
        WebClient["<b>🌐 Website (Client UI)</b>"]
    end

    subgraph Backend
        APIServer["<b>🛠️ API Server</b>"]
    end

    Nova -- WebSocket --> APIServer
    WebClient -- REST --> APIServer
    WebClient -- Runs & Stats --> APIServer
```