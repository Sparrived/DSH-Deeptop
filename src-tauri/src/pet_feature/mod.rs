//! Optional desktop-pet feature assembled as one local Tauri plugin.

pub(crate) mod care;
pub(crate) mod store;
pub(crate) mod window;

use std::fs;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Wry,
};

/// Open the isolated package directory through the marked pet command block.
#[tauri::command]
pub fn open_pets_directory(app: AppHandle) -> Result<(), String> {
    let directory = store::pets_directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建宠物目录 {}：{error}", directory.display()))?;
    crate::open_with_system_default(&directory)
}

/// Build the optional feature lifecycle without creating a WebView during app setup.
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("desktop-pets")
        .setup(|app, _api| {
            app.manage(window::PetWindowRuntime::default());
            app.manage(store::PickedBundles::default());
            Ok(())
        })
        .build()
}
