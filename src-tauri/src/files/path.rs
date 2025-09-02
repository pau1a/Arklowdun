use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn sanitize_relative_path(p: &str) -> PathBuf {
    let mut result = PathBuf::new();
    for comp in Path::new(p).components() {
        match comp {
            Component::Normal(s) => result.push(s),
            Component::ParentDir => {
                result.pop();
            }
            _ => {}
        }
    }
    result
}

pub fn resolve_path(app: &AppHandle, root_key: &str, rel: &str) -> Option<PathBuf> {
    let base = match root_key {
        "appData" => app.path().app_data_dir().ok()?,
        "appConfig" => app.path().app_config_dir().ok()?,
        "appLocalData" => app.path().app_local_data_dir().ok()?,
        "appCache" => app.path().app_cache_dir().ok()?,
        "audio" => app.path().audio_dir().ok()?,
        "cache" => app.path().cache_dir().ok()?,
        "config" => app.path().config_dir().ok()?,
        "data" => app.path().data_dir().ok()?,
        "desktop" => app.path().desktop_dir().ok()?,
        "document" => app.path().document_dir().ok()?,
        "download" => app.path().download_dir().ok()?,
        "font" => app.path().font_dir().ok()?,
        "home" => app.path().home_dir().ok()?,
        "localData" => app.path().local_data_dir().ok()?,
        "picture" => app.path().picture_dir().ok()?,
        "public" => app.path().public_dir().ok()?,
        "resource" => app.path().resource_dir().ok()?,
        "runtime" => app.path().runtime_dir().ok()?,
        "temp" => app.path().temp_dir().ok()?,
        "template" => app.path().template_dir().ok()?,
        "video" => app.path().video_dir().ok()?,
        _ => return None,
    };
    Some(base.join(sanitize_relative_path(rel)))
}
