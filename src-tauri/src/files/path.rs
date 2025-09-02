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
        "appData" => app.path().app_data_dir()?,
        "appConfig" => app.path().app_config_dir()?,
        "appLocalData" => app.path().app_local_data_dir()?,
        "appCache" => app.path().app_cache_dir()?,
        "audio" => app.path().audio_dir()?,
        "cache" => app.path().cache_dir()?,
        "config" => app.path().config_dir()?,
        "data" => app.path().data_dir()?,
        "desktop" => app.path().desktop_dir()?,
        "document" => app.path().document_dir()?,
        "download" => app.path().download_dir()?,
        "font" => app.path().font_dir()?,
        "home" => app.path().home_dir()?,
        "localData" => app.path().local_data_dir()?,
        "picture" => app.path().picture_dir()?,
        "public" => app.path().public_dir()?,
        "resource" => app.path().resource_dir()?,
        "runtime" => app.path().runtime_dir()?,
        "temp" => app.path().temp_dir()?,
        "template" => app.path().template_dir()?,
        "video" => app.path().video_dir()?,
        _ => return None,
    };
    Some(base.join(sanitize_relative_path(rel)))
}
