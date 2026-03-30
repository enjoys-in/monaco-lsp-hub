// Language configurations: sample code and metadata for each language

export interface LanguageConfig {
    id: string;
    languageId: string; // Monaco language identifier
    fileExtension: string;
    serverName: string;
    sampleCode: string;
}

export const languages: Record<string, LanguageConfig> = {
    json: {
        id: "json",
        languageId: "json",
        fileExtension: "json",
        serverName: "JSON Language Server",
        sampleCode: `{
  "name": "monaco-lsp-hub",
  "version": "1.0.0",
  "description": "Multi-language editor with LSP",
  "dependencies": {
    "express": "^4.21.0",
    "monaco-languageclient": "^10.7.0"
  },
  "scripts": {
    "start": "node server.js",
    "build": "vite build"
  }
}`,
    },

    html: {
        id: "html",
        languageId: "html",
        fileExtension: "html",
        serverName: "HTML Language Server",
        sampleCode: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
    <style>
        body { font-family: sans-serif; margin: 2rem; }
        .container { max-width: 800px; margin: 0 auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Hello, World!</h1>
        <p>This is a sample HTML page with LSP support.</p>
        <button onclick="alert('clicked!')">Click me</button>
    </div>
</body>
</html>`,
    },

    css: {
        id: "css",
        languageId: "css",
        fileExtension: "css",
        serverName: "CSS Language Server",
        sampleCode: `/* Modern CSS with variables and grid */
:root {
    --primary: #0078d4;
    --bg: #ffffff;
    --text: #333333;
    --radius: 8px;
}

body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
}

.container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
}

.card {
    background: white;
    border-radius: var(--radius);
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s, box-shadow 0.2s;
}

.card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

@media (max-width: 768px) {
    .container {
        grid-template-columns: 1fr;
        padding: 1rem;
    }
}`,
    },

    markdown: {
        id: "markdown",
        languageId: "markdown",
        fileExtension: "md",
        serverName: "Markdown Language Server",
        sampleCode: `# Monaco LSP Hub

A **multi-language** editor with full LSP support.

## Features

- Real-time diagnostics
- Auto-completion
- Hover documentation
- Go to definition

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

### Configuration

| Option | Default | Description         |
|--------|---------|---------------------|
| port   | 9600    | UI server port      |
| backend| 9601    | Backend server port |

> **Note:** Language servers are spawned on demand.

[Learn more](https://github.com/example/monaco-lsp-hub)`,
    },

    yaml: {
        id: "yaml",
        languageId: "yaml",
        fileExtension: "yaml",
        serverName: "YAML Language Server",
        sampleCode: `# Docker Compose configuration
version: "3.8"

services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    depends_on:
      - api
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://user:pass@db:5432/app
    ports:
      - "3000:3000"
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:`,
    },

    typescript: {
        id: "typescript",
        languageId: "typescript",
        fileExtension: "ts",
        serverName: "TypeScript Language Server",
        sampleCode: `interface User {
    id: number;
    name: string;
    email: string;
    role: "admin" | "user" | "moderator";
}

interface ApiResponse<T> {
    data: T;
    status: number;
    message: string;
}

async function fetchUsers(): Promise<ApiResponse<User[]>> {
    const response = await fetch("/api/users");
    if (!response.ok) {
        throw new Error(\`HTTP error: \${response.status}\`);
    }
    return response.json();
}

function filterByRole(users: User[], role: User["role"]): User[] {
    return users.filter((user) => user.role === role);
}

async function main(): Promise<void> {
    const { data: users } = await fetchUsers();
    const admins = filterByRole(users, "admin");
    console.log(\`Found \${admins.length} admins\`);

    for (const admin of admins) {
        console.log(\`  - \${admin.name} (\${admin.email})\`);
    }
}

main().catch(console.error);`,
    },

    python: {
        id: "python",
        languageId: "python",
        fileExtension: "py",
        serverName: "Pyright Language Server",
        sampleCode: `from dataclasses import dataclass
from typing import Optional
import asyncio


@dataclass
class User:
    id: int
    name: str
    email: str
    role: str = "user"


class UserRepository:
    def __init__(self) -> None:
        self._users: dict[int, User] = {}

    def add(self, user: User) -> None:
        self._users[user.id] = user

    def get(self, user_id: int) -> Optional[User]:
        return self._users.get(user_id)

    def find_by_role(self, role: str) -> list[User]:
        return [u for u in self._users.values() if u.role == role]

    def count(self) -> int:
        return len(self._users)


async def main() -> None:
    repo = UserRepository()

    repo.add(User(1, "Alice", "alice@example.com", "admin"))
    repo.add(User(2, "Bob", "bob@example.com", "user"))
    repo.add(User(3, "Charlie", "charlie@example.com", "moderator"))

    admins = repo.find_by_role("admin")
    print(f"Found {len(admins)} admins")

    for admin in admins:
        print(f"  - {admin.name} ({admin.email})")


if __name__ == "__main__":
    asyncio.run(main())`,
    },

    bash: {
        id: "bash",
        languageId: "shell",
        fileExtension: "sh",
        serverName: "Bash Language Server",
        sampleCode: `#!/usr/bin/env bash
set -euo pipefail

# Configuration
readonly APP_NAME="monaco-lsp-hub"
readonly LOG_FILE="/var/log/\${APP_NAME}.log"

log() {
    local level="\$1"; shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [\${level}] \$*" | tee -a "\${LOG_FILE}"
}

check_dependencies() {
    local deps=("docker" "curl" "jq")
    for dep in "\${deps[@]}"; do
        if ! command -v "\${dep}" &>/dev/null; then
            log "ERROR" "Missing dependency: \${dep}"
            return 1
        fi
    done
    log "INFO" "All dependencies found"
}

start_services() {
    local compose_file="\${1:-docker-compose.yml}"

    if [[ ! -f "\${compose_file}" ]]; then
        log "ERROR" "Compose file not found: \${compose_file}"
        exit 1
    fi

    log "INFO" "Starting services from \${compose_file}..."
    docker compose -f "\${compose_file}" up -d

    log "INFO" "Waiting for health checks..."
    sleep 5

    local running
    running=$(docker compose ps --format json | jq -r '.State' | grep -c "running")
    log "INFO" "\${running} services running"
}

main() {
    check_dependencies
    start_services "\$@"
    log "INFO" "Done!"
}

main "\$@"`,
    },

    dockerfile: {
        id: "dockerfile",
        languageId: "dockerfile",
        fileExtension: "Dockerfile",
        serverName: "Dockerfile Language Server",
        sampleCode: `FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN npm install --frozen-lockfile

COPY . .
RUN npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:20-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./

USER app

EXPOSE 9601

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \\
    CMD wget -qO- http://localhost:9601/health || exit 1

CMD ["node", "dist/main.js"]`,
    },

    rust: {
        id: "rust",
        languageId: "rust",
        fileExtension: "rs",
        serverName: "Rust (rust-analyzer)",
        sampleCode: `use std::collections::HashMap;

#[derive(Debug, Clone)]
struct User {
    id: u64,
    name: String,
    email: String,
    role: Role,
}

#[derive(Debug, Clone, PartialEq)]
enum Role {
    Admin,
    User,
    Moderator,
}

struct UserRepository {
    users: HashMap<u64, User>,
}

impl UserRepository {
    fn new() -> Self {
        Self { users: HashMap::new() }
    }

    fn add(&mut self, user: User) {
        self.users.insert(user.id, user);
    }

    fn get(&self, id: u64) -> Option<&User> {
        self.users.get(&id)
    }

    fn find_by_role(&self, role: &Role) -> Vec<&User> {
        self.users.values().filter(|u| &u.role == role).collect()
    }
}

fn main() {
    let mut repo = UserRepository::new();

    repo.add(User {
        id: 1, name: "Alice".into(),
        email: "alice@example.com".into(), role: Role::Admin,
    });
    repo.add(User {
        id: 2, name: "Bob".into(),
        email: "bob@example.com".into(), role: Role::User,
    });

    let admins = repo.find_by_role(&Role::Admin);
    println!("Found {} admins", admins.len());
    for admin in &admins {
        println!("  - {} ({})", admin.name, admin.email);
    }
}`,
    },

    go: {
        id: "go",
        languageId: "go",
        fileExtension: "go",
        serverName: "Go (gopls)",
        sampleCode: `package main

import (
\t"fmt"
\t"strings"
)

type User struct {
\tID    int
\tName  string
\tEmail string
\tRole  string
}

type UserRepository struct {
\tusers map[int]User
}

func NewUserRepository() *UserRepository {
\treturn &UserRepository{users: make(map[int]User)}
}

func (r *UserRepository) Add(user User) {
\tr.users[user.ID] = user
}

func (r *UserRepository) Get(id int) (User, bool) {
\tu, ok := r.users[id]
\treturn u, ok
}

func (r *UserRepository) FindByRole(role string) []User {
\tvar result []User
\tfor _, u := range r.users {
\t\tif strings.EqualFold(u.Role, role) {
\t\t\tresult = append(result, u)
\t\t}
\t}
\treturn result
}

func main() {
\trepo := NewUserRepository()

\trepo.Add(User{1, "Alice", "alice@example.com", "admin"})
\trepo.Add(User{2, "Bob", "bob@example.com", "user"})
\trepo.Add(User{3, "Charlie", "charlie@example.com", "moderator"})

\tadmins := repo.FindByRole("admin")
\tfmt.Printf("Found %d admins\\n", len(admins))
\tfor _, a := range admins {
\t\tfmt.Printf("  - %s (%s)\\n", a.Name, a.Email)
\t}
}`,
    },

    lua: {
        id: "lua",
        languageId: "lua",
        fileExtension: "lua",
        serverName: "Lua Language Server",
        sampleCode: `---@class User
---@field id number
---@field name string
---@field email string
---@field role string
local User = {}
User.__index = User

---@param id number
---@param name string
---@param email string
---@param role? string
---@return User
function User.new(id, name, email, role)
    return setmetatable({
        id = id,
        name = name,
        email = email,
        role = role or "user",
    }, User)
end

function User:__tostring()
    return string.format("%s (%s) [%s]", self.name, self.email, self.role)
end

---@class UserRepository
---@field private users table<number, User>
local UserRepository = {}
UserRepository.__index = UserRepository

function UserRepository.new()
    return setmetatable({ users = {} }, UserRepository)
end

---@param user User
function UserRepository:add(user)
    self.users[user.id] = user
end

---@param role string
---@return User[]
function UserRepository:find_by_role(role)
    local result = {}
    for _, user in pairs(self.users) do
        if user.role == role then
            table.insert(result, user)
        end
    end
    return result
end

-- Main
local repo = UserRepository.new()
repo:add(User.new(1, "Alice", "alice@example.com", "admin"))
repo:add(User.new(2, "Bob", "bob@example.com", "user"))
repo:add(User.new(3, "Charlie", "charlie@example.com", "moderator"))

local admins = repo:find_by_role("admin")
print(string.format("Found %d admins", #admins))
for _, admin in ipairs(admins) do
    print("  - " .. tostring(admin))
end`,
    },

    java: {
        id: "java",
        languageId: "java",
        fileExtension: "java",
        serverName: "Java (Eclipse JDT LS)",
        sampleCode: `import java.util.*;
import java.util.stream.Collectors;

public class Main {

    record User(int id, String name, String email, String role) {}

    static class UserRepository {
        private final Map<Integer, User> users = new HashMap<>();

        void add(User user) {
            users.put(user.id(), user);
        }

        Optional<User> get(int id) {
            return Optional.ofNullable(users.get(id));
        }

        List<User> findByRole(String role) {
            return users.values().stream()
                .filter(u -> u.role().equalsIgnoreCase(role))
                .collect(Collectors.toList());
        }
    }

    public static void main(String[] args) {
        var repo = new UserRepository();

        repo.add(new User(1, "Alice", "alice@example.com", "admin"));
        repo.add(new User(2, "Bob", "bob@example.com", "user"));
        repo.add(new User(3, "Charlie", "charlie@example.com", "moderator"));

        var admins = repo.findByRole("admin");
        System.out.printf("Found %d admins%n", admins.size());
        for (var admin : admins) {
            System.out.printf("  - %s (%s)%n", admin.name(), admin.email());
        }
    }
}`,
    },

    c: {
        id: "c",
        languageId: "c",
        fileExtension: "c",
        serverName: "C/C++ (clangd)",
        sampleCode: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_USERS 100

typedef enum { ROLE_ADMIN, ROLE_USER, ROLE_MODERATOR } Role;

typedef struct {
    int id;
    char name[64];
    char email[128];
    Role role;
} User;

typedef struct {
    User users[MAX_USERS];
    int count;
} UserRepository;

void repo_init(UserRepository *repo) {
    repo->count = 0;
}

int repo_add(UserRepository *repo, User user) {
    if (repo->count >= MAX_USERS) return -1;
    repo->users[repo->count++] = user;
    return 0;
}

int repo_find_by_role(const UserRepository *repo, Role role,
                      User *results, int max_results) {
    int found = 0;
    for (int i = 0; i < repo->count && found < max_results; i++) {
        if (repo->users[i].role == role) {
            results[found++] = repo->users[i];
        }
    }
    return found;
}

int main(void) {
    UserRepository repo;
    repo_init(&repo);

    User alice = {1, "Alice", "alice@example.com", ROLE_ADMIN};
    User bob = {2, "Bob", "bob@example.com", ROLE_USER};
    repo_add(&repo, alice);
    repo_add(&repo, bob);

    User admins[MAX_USERS];
    int count = repo_find_by_role(&repo, ROLE_ADMIN, admins, MAX_USERS);

    printf("Found %d admins\\n", count);
    for (int i = 0; i < count; i++) {
        printf("  - %s (%s)\\n", admins[i].name, admins[i].email);
    }

    return 0;
}`,
    },
};
