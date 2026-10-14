use crate::{apps::Runtime, contracts, overlay};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager,
};

pub const ID: &str = "orbit";

fn label(name: &str, shortcut: Option<&str>) -> String {
    match shortcut {
        Some(shortcut) => format!("{name} ({shortcut})"),
        None => name.into(),
    }
}

pub fn menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    for (id, text) in [
        ("home", "Apri Orbit (Ctrl+E)"),
        ("catalog", "App e catalogo"),
    ] {
        let item =
            MenuItem::with_id(app, id, text, true, None::<&str>).map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let installed = app
        .state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .installed
        .clone();
    for record in installed.values().filter(|record| record.enabled) {
        let manifest = &record.manifest;
        let submenu = Submenu::new(
            app,
            &manifest.name,
            contracts::ready(&manifest.id, &installed),
        )
        .map_err(|e| e.to_string())?;
        let open = MenuItem::with_id(
            app,
            format!("app:{}:open", manifest.id),
            label("Apri", record.shortcut()),
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&open).map_err(|e| e.to_string())?;
        for action in &manifest.actions {
            let item = MenuItem::with_id(
                app,
                format!("app:{}:{}", manifest.id, action.id),
                label(&action.label, record.action_shortcut(action)),
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            submenu.append(&item).map_err(|e| e.to_string())?;
        }
        menu.append(&submenu).map_err(|e| e.to_string())?;
    }
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    menu.append(
        &MenuItem::with_id(app, "quit", "Esci da Orbit", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(menu)
}

pub fn refresh(app: &AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(ID) {
        tray.set_menu(Some(menu(app)?))
            .map_err(|e| format!("Aggiornamento menu tray non riuscito: {e}"))?;
    }
    Ok(())
}

pub fn activate(app: &AppHandle, id: &str) {
    if id == "quit" {
        crate::quit_app(app.clone());
        return;
    }
    let app = app.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let result = if let Some((package, action)) =
            id.strip_prefix("app:").and_then(|id| id.split_once(':'))
        {
            if action == "open" {
                crate::apps::launch_app(app.clone(), package.into()).await
            } else {
                crate::apps::launch_app_action(app.clone(), package.into(), action.into()).await
            }
        } else {
            overlay::open_tool(app.clone(), id).await
        };
        if let Err(error) = result {
            overlay::report(&app, error);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_show_effective_shortcuts_without_native_accelerators() {
        assert_eq!(label("Apri", Some("Ctrl+2")), "Apri (Ctrl+2)");
        assert_eq!(label("Apri", None), "Apri");
    }
}
