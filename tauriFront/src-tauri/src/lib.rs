// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri::{Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

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

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chat_history.db", migrations)
                .build(),
        )
        .setup(|app| {
            // 获取主窗口
            let main_window = app.get_webview_window("main").expect("找不到主窗口");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            minimize_window,
            toggle_maximize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
