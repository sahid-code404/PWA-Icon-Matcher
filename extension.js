/**
 * PWA Icon Matcher - GNOME Shell Extension Entry Point
 *
 * Automatically detects Progressive Web App (PWA) desktop launchers created by
 * supported browsers and replaces hardcoded icon paths with matching icon names
 * from the user's active Linux icon theme.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { logger } from './lib/logger.js';
import { StateManager } from './lib/state-manager.js';
import { IconResolver } from './lib/icon-resolver.js';
import { FileWriter } from './lib/file-writer.js';
import { PwaDetector } from './lib/pwa-detector.js';
import { IconMatcher } from './lib/icon-matcher.js';
import { ApplicationFileMonitor } from './lib/file-monitor.js';

export default class PwaIconMatcherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsSignals = [];

        // Configure logger from preferences
        const updateDebug = () => {
            logger.setDebugEnabled(this._settings.get_boolean('debug-logging'));
        };
        updateDebug();
        this._settingsSignals.push(
            this._settings.connect('changed::debug-logging', updateDebug)
        );

        logger.info('Enabling PWA Icon Matcher extension');

        // Check master enable switch
        const isMasterEnabled = this._settings.get_boolean('enabled');
        if (!isMasterEnabled) {
            logger.info('PWA Icon Matcher is disabled in settings; standing by');
        }

        // Initialize components
        this._stateManager = new StateManager();
        this._stateManager.load();

        // Use GNOME Shell native St.IconTheme
        const stTheme = new St.IconTheme();
        this._iconResolver = new IconResolver(stTheme, this._settings);
        this._fileWriter = new FileWriter();
        this._pwaDetector = new PwaDetector(this._settings);

        this._iconMatcher = new IconMatcher({
            settings: this._settings,
            detector: this._pwaDetector,
            resolver: this._iconResolver,
            stateManager: this._stateManager,
            fileWriter: this._fileWriter
        });

        this._fileMonitor = new ApplicationFileMonitor(this._iconMatcher, {
            settings: this._settings,
            onLauncherUpdated: (appId) => this._refreshAllAreas(appId)
        });

        // Watch master enabled switch
        this._settingsSignals.push(
            this._settings.connect('changed::enabled', () => {
                const enabled = this._settings.get_boolean('enabled');
                if (enabled && !this._fileMonitor.isRunning()) {
                    // Instantly sync existing launchers once when re-enabled, then monitor for new PWAs
                    this._fileMonitor.start(true);
                } else if (!enabled && this._fileMonitor.isRunning()) {
                    this._fileMonitor.stop();
                }
            })
        );

        // Start file monitoring and instantly sync once when enabled
        if (isMasterEnabled) {
            this._fileMonitor.start(true);
        }

        // Automatic instant re-sync and fallback across all UI areas on system icon theme change
        this._interfaceSettings = null;
        this._interfaceSignalId = 0;
        this._themeChangeDebounceId = 0;

        try {
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._interfaceSignalId = this._interfaceSettings.connect('changed::icon-theme', () => {
                logger.info('System icon theme changed; immediately resyncing PWA launchers and refreshing all areas');

                if (this._themeChangeDebounceId > 0) {
                    GLib.Source.remove(this._themeChangeDebounceId);
                    this._themeChangeDebounceId = 0;
                }

                // Tight 20ms debounce to allow GSettings signal propagation to settle,
                // then execute at high priority for aggressive near-instant response
                this._themeChangeDebounceId = GLib.timeout_add(GLib.PRIORITY_HIGH, 20, () => {
                    this._themeChangeDebounceId = 0;
                    if (!this._fileMonitor || !this._fileMonitor.isRunning()) {
                        return GLib.SOURCE_REMOVE;
                    }

                    // 1. Clear resolver cache and rescan icon theme caches immediately
                    try {
                        if (this._iconResolver) {
                            this._iconResolver.clearCache();
                        }
                        const textureCache = St.TextureCache.get_default();
                        if (textureCache && typeof textureCache.rescan_icon_theme === 'function') {
                            textureCache.rescan_icon_theme();
                        }
                        if (this._iconResolver && this._iconResolver._themeBackend) {
                            if (typeof this._iconResolver._themeBackend.rescan_if_needed === 'function') {
                                this._iconResolver._themeBackend.rescan_if_needed();
                            }
                        }
                    } catch (e) {
                        logger.debug(`Error rescanning theme backend: ${e.message}`);
                    }

                    // 2. Parallel batch resync and immediate multi-area UI refresh
                    this._fileMonitor.resyncAllLaunchers().then(() => {
                        this._refreshAllAreas(null);
                    }).catch(err => {
                        logger.error('Error during theme switch resync', err);
                    });

                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (err) {
            logger.debug('Could not bind icon-theme listener: ' + err.message);
        }
    }

    disable() {
        logger.info('Disabling PWA Icon Matcher extension');

        // Cancel theme change debounce timer
        if (this._themeChangeDebounceId > 0) {
            GLib.Source.remove(this._themeChangeDebounceId);
            this._themeChangeDebounceId = 0;
        }

        // Disconnect theme settings signal
        if (this._interfaceSettings && this._interfaceSignalId) {
            this._interfaceSettings.disconnect(this._interfaceSignalId);
            this._interfaceSignalId = 0;
            this._interfaceSettings = null;
        }

        // Stop file monitor and cancel debounces/timers
        if (this._fileMonitor) {
            this._fileMonitor.destroy();
            this._fileMonitor = null;
        }

        // Disconnect settings signals
        if (this._settings && this._settingsSignals) {
            for (const sigId of this._settingsSignals) {
                this._settings.disconnect(sigId);
            }
            this._settingsSignals = [];
        }

        // Clean up components and break references for GC
        if (this._iconMatcher) {
            this._iconMatcher.destroy();
            this._iconMatcher = null;
        }

        this._pwaDetector = null;
        this._fileWriter = null;
        this._iconResolver = null;
        this._stateManager = null;
        this._settings = null;
    }

    /**
     * Aggressively refreshes icons across all GNOME Shell UI surfaces:
     * - Overview App Grid (tiles, folders, sub-folders)
     * - Dash / Dock (default GNOME dash, running favorites, dash containers)
     * - Shell.AppSystem cache and external dock signals (aqua-dock-pro, dash-to-dock, etc.)
     * - Active Search Results in Overview
     * - Native St Texture Cache
     *
     * After updating all surfaces, all references are dropped and the extension returns
     * to a completely idle state with zero background resource consumption.
     */
    _refreshAllAreas(appId = null) {
        try {
            // 1. Rescan Shell & St icon cache immediately
            const textureCache = St.TextureCache.get_default();
            if (textureCache && typeof textureCache.rescan_icon_theme === 'function') {
                textureCache.rescan_icon_theme();
            }

            // 2. Notify Shell.AppSystem to invalidate its internal desktop app cache
            // and trigger updates in all dock extensions (like aqua-dock-pro, dash-to-dock, etc.)
            // and window switchers (Alt-Tab)
            try {
                const appSys = Shell.AppSystem.get_default();
                if (appSys && typeof appSys.emit === 'function') {
                    appSys.emit('installed-changed');
                }
            } catch (_) {}

            // Helper to refresh an AppIcon instance directly with fresh GDesktopAppInfo
            const refreshAppIcon = (appIcon) => {
                if (!appIcon) return;
                const itemId = appIcon.id || (appIcon.app && typeof appIcon.app.get_id === 'function' ? appIcon.app.get_id() : null);
                const isTarget = !appId || (itemId === appId);

                if (itemId && isTarget) {
                    const desktopPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', itemId]);
                    if (GLib.file_test(desktopPath, GLib.FileTest.EXISTS)) {
                        try {
                            const newAppInfo = Gio.DesktopAppInfo.new_from_filename(desktopPath);
                            if (newAppInfo && appIcon.icon) {
                                const newGIcon = newAppInfo.get_icon();
                                if (newGIcon) {
                                    appIcon.icon.createIcon = (size) => new St.Icon({
                                        gicon: newGIcon,
                                        icon_size: size,
                                    });
                                }
                            }
                        } catch (_) {}
                    }
                    if (appIcon.icon && typeof appIcon.icon.update === 'function') {
                        appIcon.icon.update();
                    }
                }
            };

            // Recursive helper for App Grid items (including folders and nested folder items)
            const refreshGridItem = (item) => {
                if (!item) return;

                refreshAppIcon(item);

                // If folder icon, recurse into sub items
                if (item.view?._items) {
                    for (const subItem of item.view._items.values()) {
                        refreshGridItem(subItem);
                    }
                    if (item.icon && typeof item.icon.update === 'function') {
                        item.icon.update();
                    }
                }
            };

            // 3. Overview App Grid
            const appDisplay = Main.overview?._overview?.controls?.appDisplay ??
                               Main.overview?._overview?._controls?.appDisplay ??
                               Main.overview?._overview?._controls?._appDisplay ??
                               Main.overview?.appDisplay;

            if (appDisplay) {
                if (appId && appDisplay._items?.has(appId)) {
                    refreshGridItem(appDisplay._items.get(appId));
                } else if (appDisplay._items) {
                    for (const item of appDisplay._items.values()) {
                        refreshGridItem(item);
                    }
                }

                if (appDisplay._folderIcons) {
                    for (const folder of appDisplay._folderIcons) {
                        refreshGridItem(folder);
                    }
                }
            }

            // 4. GNOME Shell Dash (Default Dock / Dash)
            const dash = Main.overview?.dash ??
                         Main.overview?._overview?.controls?.dash ??
                         Main.overview?._overview?._controls?.dash;

            if (dash?._box) {
                const dashContainers = dash._box.get_children();
                for (const container of dashContainers) {
                    const child = container.child || container;
                    refreshAppIcon(child);
                }
            }

            // 5. Active Overview Search (if currently open/searching)
            try {
                const searchController = Main.overview?._overview?.controls?.searchController ??
                                         Main.overview?._overview?._controls?.searchController ??
                                         Main.overview?.searchController;
                if (searchController && typeof searchController.search === 'function' && searchController._entry?.text) {
                    searchController.search();
                }
            } catch (_) {}

            // 6. Direct dock refresh for aqua-dock-pro if present
            try {
                if (global.aquaDock && typeof global.aquaDock.refresh === 'function') {
                    global.aquaDock.refresh();
                }
            } catch (_) {}

        } catch (err) {
            logger.debug(`Error during live-refresh of all areas: ${err.message}`);
        }
    }
}
