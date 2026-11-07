/**
 * PWA Icon Matcher - State Manager
 *
 * Persists original icon paths and modification records in ~/.local/state/pwa-icon-matcher/state.json
 * Enables full reversibility, guarantees idempotent original icon preservation,
 * and uses atomic file replacement.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { logger } from './logger.js';

const STATE_VERSION = 1;

export class StateManager {
    /**
     * @param {string} [customStateDir] - Optional directory override for testing
     */
    constructor(customStateDir = null) {
        const baseDir = customStateDir || GLib.get_user_state_dir();
        this._stateDir = GLib.build_filenamev([baseDir, 'pwa-icon-matcher']);
        this._stateFile = GLib.build_filenamev([this._stateDir, 'state.json']);
        this._entries = new Map();
        this._loaded = false;
    }

    getStateFilePath() {
        return this._stateFile;
    }

    /**
     * Loads the state file from disk.
     */
    load() {
        this._entries.clear();
        this._loaded = true;

        const file = Gio.File.new_for_path(this._stateFile);
        if (!file.query_exists(null)) {
            logger.debug(`State file does not exist yet at ${this._stateFile}`);
            return;
        }

        try {
            const [success, contents] = file.load_contents(null);
            if (!success || !contents) return;

            const decoder = new TextDecoder('utf-8');
            const jsonStr = decoder.decode(contents);
            const data = JSON.parse(jsonStr);

            if (data && typeof data === 'object' && data.entries) {
                for (const [filename, record] of Object.entries(data.entries)) {
                    if (record && typeof record === 'object') {
                        this._entries.set(filename, record);
                    }
                }
            }
            logger.debug(`Loaded ${this._entries.size} state entries from ${this._stateFile}`);
        } catch (err) {
            logger.error(`Error loading state file: ${err.message}`, err);
            // On parse error, proceed with empty in-memory state rather than crashing
        }
    }

    /**
     * Persists the state atomically to disk.
     */
    save() {
        try {
            // Ensure directory exists
            GLib.mkdir_with_parents(this._stateDir, 0o755);

            const data = {
                version: STATE_VERSION,
                entries: Object.fromEntries(this._entries)
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const encoder = new TextEncoder();
            const bytes = encoder.encode(jsonStr);

            const file = Gio.File.new_for_path(this._stateFile);
            file.replace_contents(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            logger.debug(`Saved ${this._entries.size} state records to ${this._stateFile}`);
        } catch (err) {
            logger.error(`Failed to save state file: ${err.message}`, err);
        }
    }

    /**
     * Records an icon modification.
     * Preserves originalIcon if the file was already previously modified.
     *
     * @param {string} desktopFile - Basename of desktop file
     * @param {string} originalIcon - Icon value before modification
     * @param {string} matchedIcon - New theme icon name
     * @param {string} [appName]
     * @param {string} [browser]
     */
    recordModification(desktopFile, originalIcon, matchedIcon, appName = '', browser = '') {
        if (!this._loaded) this.load();

        const existing = this._entries.get(desktopFile);
        // Do not overwrite original icon information when reprocessing an already-patched entry!
        const trueOriginalIcon = (existing && existing.originalIcon) ? existing.originalIcon : originalIcon;

        const record = {
            desktopFile,
            originalIcon: trueOriginalIcon,
            matchedIcon,
            modifiedByExtension: true,
            appName: appName || (existing ? existing.appName : ''),
            browser: browser || (existing ? existing.browser : ''),
            timestamp: Date.now()
        };

        this._entries.set(desktopFile, record);
        this.save();
    }

    getEntry(desktopFile) {
        if (!this._loaded) this.load();
        return this._entries.get(desktopFile) || null;
    }

    hasEntry(desktopFile) {
        if (!this._loaded) this.load();
        return this._entries.has(desktopFile);
    }

    removeEntry(desktopFile) {
        if (!this._loaded) this.load();
        if (this._entries.has(desktopFile)) {
            this._entries.delete(desktopFile);
            this.save();
            return true;
        }
        return false;
    }

    getAllEntries() {
        if (!this._loaded) this.load();
        return Array.from(this._entries.values());
    }

    clearState() {
        this._entries.clear();
        this.save();
    }

    /**
     * Removes state records for desktop files that no longer exist on disk.
     *
     * @param {Set<string>|Array<string>} existingFiles
     */
    cleanMissingFiles(existingFiles) {
        if (!this._loaded) this.load();
        const existingSet = new Set(existingFiles);
        let changed = false;

        for (const filename of this._entries.keys()) {
            if (!existingSet.has(filename)) {
                this._entries.delete(filename);
                changed = true;
            }
        }

        if (changed) {
            this.save();
        }
    }
}
