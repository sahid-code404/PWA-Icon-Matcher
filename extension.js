/**
 * PWA Icon Matcher - GNOME Shell Extension Entry Point
 *
 * Automatically detects Progressive Web App (PWA) desktop launchers created by
 * supported browsers and replaces hardcoded icon paths with matching icon names
 * from the user's active Linux icon theme.
 */

import St from 'gi://St';
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
            settings: this._settings
        });

        // Watch master enabled switch
        this._settingsSignals.push(
            this._settings.connect('changed::enabled', () => {
                const enabled = this._settings.get_boolean('enabled');
                if (enabled && !this._fileMonitor.isRunning()) {
                    this._fileMonitor.start(false);
                } else if (!enabled && this._fileMonitor.isRunning()) {
                    this._fileMonitor.stop();
                }
            })
        );

        // Start file monitoring if enabled
        if (isMasterEnabled) {
            const runStartupScan = this._settings.get_boolean('startup-scan');
            this._fileMonitor.start(runStartupScan);
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
}
