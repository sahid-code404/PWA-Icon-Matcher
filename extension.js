/**
 * PWA Icon Matcher - GNOME Shell Extension Entry Point
 *
 * Automatically detects Progressive Web App (PWA) desktop launchers created by
 * supported browsers and replaces hardcoded icon paths with matching icon names
 * from the user's active Linux icon theme.
 */

import St from 'gi://St';
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
            onLauncherUpdated: (appId) => this._refreshAppGrid(appId)
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
    }

    disable() {
        logger.info('Disabling PWA Icon Matcher extension');

        // Stop file monitor and cancel debounces/timers
        if (this._fileMonitor) {
            this._fileMonitor.stop();
            this._fileMonitor = null;
        }

        // Disconnect settings signals
        if (this._settings && this._settingsSignals) {
            for (const sigId of this._settingsSignals) {
                this._settings.disconnect(sigId);
            }
            this._settingsSignals = [];
        }

        // Clean up references
        this._iconMatcher = null;
        this._pwaDetector = null;
        this._fileWriter = null;
        this._iconResolver = null;
        this._stateManager = null;
        this._settings = null;
    }

    _refreshAppGrid(appId = null) {
        try {
            const textureCache = St.TextureCache.get_default();
            if (textureCache && typeof textureCache.rescan_icon_theme === 'function') {
                textureCache.rescan_icon_theme();
            }

            const appDisplay = Main.overview?._overview?.controls?.appDisplay ??
                               Main.overview?._overview?._controls?.appDisplay ??
                               Main.overview?._overview?._controls?._appDisplay ??
                               Main.overview?.appDisplay;
            if (!appDisplay) return;

            const refreshItem = (item) => {
                if (!item) return;
                if (item.icon && typeof item.icon.update === 'function') {
                    item.icon.update();
                }
                if (item.view?._items) {
                    for (const subItem of item.view._items.values()) {
                        if (!appId || subItem.id === appId) {
                            subItem.icon?.update?.();
                        }
                    }
                }
            };

            if (appId && appDisplay._items?.has(appId)) {
                refreshItem(appDisplay._items.get(appId));
            } else if (appDisplay._items) {
                for (const item of appDisplay._items.values()) {
                    refreshItem(item);
                }
            }

            if (appDisplay._folderIcons) {
                for (const folder of appDisplay._folderIcons) {
                    refreshItem(folder);
                }
            }
        } catch (err) {
            logger.debug(`Could not live-refresh App Grid icon: ${err.message}`);
        }
    }
}
