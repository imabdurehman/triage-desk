# client

Scaffolded on `feature/frontend-auth` with Vite + React.

    npm create vite@latest . -- --template react
    npm install react-router-dom axios

Enums come from the server's `GET /api/meta` (which serves `shared/contract.json`),
so the client never keeps its own copy of categories, priorities or statuses.
