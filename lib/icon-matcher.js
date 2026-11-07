/**
 * PWA Icon Matcher - Main Icon Matcher Coordinator
 *
 * Coordinates detection, icon resolution, file writing, and state persistence.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { parseDesktopEntry } from './desktop-entry.js';
import { PwaDetector } from './pwa-detector.js';
import { IconResolver } from './icon-resolver.js';
import { StateManager } from './state-manager.js';
import { FileWriter } from './file-writer.js';
import { logger } from './logger.js';

export class IconMatcher {
    /**
     * @param {object} options
     * @param {Gio.Settings} [options.settings]
     * @param {PwaDetector} [options.detector]
     * @param {IconResolver} [options.resolver]
     * @param {StateManager} [options.stateManager]
     * @param {FileWriter} [options.fileWriter]
     * @param {string} [options.applicationsDir]
     */
    constructor(options = {}) {
        this._settings = options.settings || null;
        this._detector = options.detector || new PwaDetector(this._settings);
        this._resolver = options.resolver || new IconResolver(null, this._settings);
        this._stateManager = options.stateManager || new StateManager();
        this._fileWriter = options.fileWriter || new FileWriter();
        this._appsDir = options.applicationsDir || GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'applications'
        ]);
    }

    getDetector() { return this._detector; }
    getResolver() { return this._resolver; }
    getStateManager() { return this._stateManager; }
    getFileWriter() { return this._fileWriter; }

    _isExcluded(appName, filename) {
        if (!this._settings) return false;

        try {
            const exclusions = this._settings.get_strv('excluded-apps') || [];
            const lowerName = appName ? appName.toLowerCase() : '';
            const lowerFile = filename ? filename.toLowerCase() : '';

            return exclusions.some(item => {
                const lowerItem = item.toLowerCase();
                return lowerItem === lowerName || lowerItem === lowerFile;
            });
        } catch (err) {
            logger.error('Error checking exclusions', err);
            return false;
        }
    }

    /**
     * Evaluates and updates a single desktop file if it is an eligible PWA launcher.
     *
     * @param {string} filePath - Absolute path to desktop file
     * @returns {Promise<{
     *   success: boolean,
     *   modified: boolean,
     *   reason?: string,
     *   appName?: string,
     *   matchedIcon?: string,
     *   originalIcon?: string
     * }>}
     */
    async processDesktopFile(filePath) {
        const file = Gio.File.new_for_path(filePath);
        const filename = file.get_basename();

        if (!filename.endsWith('.desktop')) {
            return { success: false, modified: false, reason: 'not-desktop-file' };
        }

        // Fast exclusion check by filename
        if (this._isExcluded('', filename)) {
            logger.debug(`File ${filename} excluded by user preference`);
            return { success: false, modified: false, reason: 'excluded' };
        }

        let contents, etag;
        try {
            const [ok, bytes] = file.load_contents(null);
            if (!ok || !bytes) {
                return { success: false, modified: false, reason: 'read-error' };
            }
            const decoder = new TextDecoder('utf-8');
            contents = decoder.decode(bytes);
        } catch (err) {
            return { success: false, modified: false, reason: 'read-exception' };
        }

        const parsed = parseDesktopEntry(contents);
        if (!parsed.isValid) {
            return { success: false, modified: false, reason: 'invalid-desktop-entry' };
        }

        // Detect whether this is a PWA
        const pwaInfo = this._detector.detect(parsed, filename);
        if (!pwaInfo.isPwa) {
            logger.debug(`Launcher ${filename} (${parsed.name}) is not a PWA`);
            return { success: false, modified: false, reason: 'not-a-pwa' };
        }

        const appName = pwaInfo.appName || parsed.name;
        const currentIcon = parsed.icon;

        // Check exclusion by app name
        if (this._isExcluded(appName, filename)) {
            logger.debug(`App "${appName}" (${filename}) excluded by user preference`);
            return { success: false, modified: false, reason: 'excluded' };
        }

        // Resolve active theme icon
        const matchedIcon = await this._resolver.resolveIcon(appName, pwaInfo.appId);
        if (!matchedIcon) {
            logger.debug(`No theme icon found for "${appName}"`);
            return {
                success: true,
                modified: false,
                reason: 'no-theme-icon-found',
                appName,
                currentIcon
            };
        }

        // Check if file already uses this icon
        if (currentIcon === matchedIcon) {
            logger.debug(`Launcher ${filename} already uses matched icon "${matchedIcon}"`);
            // Ensure state record exists if previously modified
            if (!this._stateManager.hasEntry(filename)) {
                // If it already had the icon, record it if original was recorded elsewhere
            }
            return {
                success: true,
                modified: false,
                reason: 'already-matches',
                appName,
                matchedIcon
            };
        }

        // Check whether current icon needs correction:
        // Needs correction if it's an absolute path, or browser-specific icon prefix, or was previously modified
        const needsCorrection = currentIcon.includes('/') ||
            currentIcon.startsWith('brave-') ||
            currentIcon.startsWith('chrome-') ||
            currentIcon.startsWith('chromium-') ||
            currentIcon.startsWith('ungoogled-chromium-') ||
            currentIcon.startsWith('msedge-') ||
            currentIcon.startsWith('opera-') ||
            currentIcon.startsWith('vivaldi-') ||
            currentIcon.startsWith('ffpwa-') ||
            currentIcon.startsWith('epiphany-') ||
            currentIcon.startsWith('org.gnome.Epiphany') ||
            this._stateManager.hasEntry(filename);

        if (!needsCorrection) {
            // If user already set a custom theme icon name (not an absolute path and not browser generated), leave untouched
            logger.debug(`Launcher ${filename} has valid user-selected icon "${currentIcon}"; preserving per Section 5.4`);
            return {
                success: true,
                modified: false,
                reason: 'custom-icon-preserved',
                appName,
                currentIcon
            };
        }

        // Save modification record before or along with file write
        // Record original icon (or preserve existing true original)
        this._stateManager.recordModification(
            filename,
            currentIcon,
            matchedIcon,
            appName,
            pwaInfo.browserName || 'PWA'
        );

        // Perform safe atomic file write
        const writeResult = await this._fileWriter.updateIcon(filePath, matchedIcon, contents);
        if (!writeResult.success) {
            logger.error(`Failed to update ${filename}: ${writeResult.error}`);
            return {
                success: false,
                modified: false,
                reason: writeResult.error,
                appName
            };
        }

        logger.info(`Successfully updated "${appName}" icon to "${matchedIcon}" in ${filename}`);
        return {
            success: true,
            modified: true,
            appName,
            matchedIcon,
            originalIcon: currentIcon,
            browser: pwaInfo.browserName || 'PWA'
        };
    }

    /**
     * Restores a single modified launcher to its original icon.
     *
     * @param {string} filename - Basename of desktop file
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async restoreLauncher(filename) {
        const entry = this._stateManager.getEntry(filename);
        if (!entry) {
            return { success: false, error: 'No restoration record found' };
        }

        const filePath = GLib.build_filenamev([this._appsDir, filename]);
        const file = Gio.File.new_for_path(filePath);
        if (!file.query_exists(null)) {
            // File was deleted from disk; remove orphaned state record
            this._stateManager.removeEntry(filename);
            logger.debug(`File ${filename} no longer exists; cleaned up orphaned state record`);
            return { success: true, fileMissing: true };
        }

        const result = await this._fileWriter.restoreIcon(
            filePath,
            entry.originalIcon,
            entry.matchedIcon
        );

        if (result.success) {
            this._stateManager.removeEntry(filename);
            logger.info(`Restored "${entry.appName || filename}" to original icon`);
        }

        return result;
    }

    /**
     * Restores all modified launchers recorded in state.
     *
     * @returns {Promise<{ restoredCount: number, errors: string[] }>}
     */
    async restoreAll() {
        const entries = this._stateManager.getAllEntries();
        let restoredCount = 0;
        const errors = [];

        for (const entry of entries) {
            const res = await this.restoreLauncher(entry.desktopFile);
            if (res.success) {
                restoredCount++;
            } else if (res.error) {
                errors.push(`${entry.desktopFile}: ${res.error}`);
            }
        }

        logger.info(`Restored ${restoredCount} launcher(s) to original icons`);
        return { restoredCount, errors };
    }
}
