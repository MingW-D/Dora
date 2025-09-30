// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 定义数据库迁移
    let migrations = vec![
        Migration {
            version: 1,
            description: "create conversations table",
            sql: "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create messages table",
            sql: "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            )",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create settings table",
            sql: "CREATE TABLE IF NOT EXISTS settings (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                value TEXT
            )",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create model_configs table",
            sql: "CREATE TABLE IF NOT EXISTS model_configs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                model_name TEXT NOT NULL,
                api_url TEXT NOT NULL,
                description TEXT,
                prompt_template TEXT,
                temperature REAL DEFAULT 0.7,
                max_tokens INTEGER DEFAULT 1500,
                is_default BOOLEAN DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            kind: MigrationKind::Up,
        },
        // Migration 5 - Fixed version for plan/step tracking
        Migration {
            version: 5,
            description: "create plan and step tracking tables",
            sql: "
                CREATE TABLE IF NOT EXISTS plan_status (
                    id TEXT PRIMARY KEY,
                    message_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL,
                    plan_steps TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    confirmed_at INTEGER,
                    completed_at INTEGER,
                    task_id TEXT,
                    error TEXT,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                    UNIQUE(message_id)
                );
                
                CREATE TABLE IF NOT EXISTS step_status (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    step_number INTEGER NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    result TEXT,
                    error TEXT,
                    started_at INTEGER,
                    completed_at INTEGER,
                    FOREIGN KEY (plan_id) REFERENCES plan_status(id) ON DELETE CASCADE,
                    UNIQUE(step_id)
                );
            ",
            kind: MigrationKind::Up,
        },
    ];

    // 窗口控制命令
    #[tauri::command]
    fn minimize_window(window: tauri::Window) {
        let _ = window.minimize();
    }

    #[tauri::command]
    fn toggle_maximize_window(window: tauri::Window) {
        if let Ok(true) = window.is_maximized() {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }

    #[tauri::command]
    fn close_window(window: tauri::Window) {
        let _ = window.close();
    }

    // HTTP代理命令
    #[derive(Serialize, Deserialize)]
    struct HttpRequest {
        url: String,
        method: String,
        headers: Option<HashMap<String, String>>,
        body: Option<String>,
    }

    #[derive(Serialize, Deserialize)]
    struct HttpResponse {
        status: u16,
        headers: HashMap<String, String>,
        body: String,
    }

    #[tauri::command]
    async fn http_request(
        url: String,
        method: String,
        headers: Option<HashMap<String, String>>,
        body: Option<String>
    ) -> Result<HttpResponse, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
        
        let mut req_builder = match method.to_uppercase().as_str() {
            "GET" => client.get(&url),
            "POST" => client.post(&url),
            "PUT" => client.put(&url),
            "DELETE" => client.delete(&url),
            _ => return Err(format!("Unsupported HTTP method: {}", method)),
        };

        // 添加请求头
        if let Some(headers) = headers {
            for (key, value) in headers {
                req_builder = req_builder.header(&key, &value);
            }
        }

        // 添加请求体
        if let Some(body) = body {
            req_builder = req_builder.body(body);
        }

        let response = req_builder.send().await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status().as_u16();
        let headers: HashMap<String, String> = response.headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();

        let body = response.text().await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chat_history.db", migrations)
                .build(),
        )
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            minimize_window,
            toggle_maximize_window,
            close_window,
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
