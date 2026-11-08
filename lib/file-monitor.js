/**
 * PWA Icon Matcher - Event-Driven Application Directory Monitor
 *
 * Implements single Gio.FileMonitor event handling, debouncing,
 * self-modification suppression, and one-pass bounded async startup scanning.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { logger } from './logger.js';

const DEBOUNCE_MS = 50;
const SCAN_BATCH_SIZE = 128;

export class ApplicationFileMonitor {
    /**
     * @param {IconMatcher} iconMatcher
     * @param {object} [options]
     * @param {string} [options.applicationsDir]
     * @param {Gio.Settings} [options.settings]
     */
    constructor(iconMatcher, options = {}) {
        this._iconMatcher = iconMatcher;
        this._settings = options.settings || null;
        this._onLauncherUpdated = typeof options.onLauncherUpdated === 'function' ? options.onLauncherUpdated : null;
        this._appsDir = options.applicationsDir || GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'applications'
        ]);

        this._monitor = null;
        this._monitorSignalId = 0;
        this._pendingDebounces = new Map(); // filePath -> timeoutSourceId
        this._cancellable = null;
        this._isRunning = false;
    }

    isRunning() {
        return this._isRunning;
    }

    /**
     * Starts directory monitoring and optionally performs a one-pass startup scan.
     *
     * @param {boolean} [performStartupScan=true]
     */
    async start(performStartupScan = true) {
        if (this._isRunning) return;
        this._isRunning = true;
        this._cancellable = new Gio.Cancellable();

        const dirFile = Gio.File.new_for_path(this._appsDir);
        if (!dirFile.query_exists(null)) {
            try {
                dirFile.make_directory_with_parents(null);
            } catch (err) {
                logger.error(`Could not create applications directory: ${this._appsDir}`, err);
            }
        }

        try {
            this._monitor = dirFile.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES,
                this._cancellable
            );

            this._monitorSignalId = this._monitor.connect(
                'changed',
                (monitor, file, otherFile, eventType) => {
                    this._onFileChanged(file, otherFile, eventType);
                }
            );

            logger.info(`Directory monitor started for ${this._appsDir}`);
        } catch (err) {
            logger.error(`Failed to start file monitor on ${this._appsDir}`, err);
        }

        if (performStartupScan) {
            await this.scanDirectoryOnce();
        }
    }

    /**
     * Stops monitoring, cancels all pending debounces and async tasks.
     */
    stop() {
        if (!this._isRunning) return;
        this._isRunning = false;

        // Cancel any pending async file operations
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable = null;
        }

        // Cancel and clear all pending debounces
        for (const [filePath, sourceId] of this._pendingDebounces.entries()) {
            if (sourceId) {
                GLib.Source.remove(sourceId);
            }
        }
        this._pendingDebounces.clear();

        // Disconnect directory monitor
        if (this._monitor) {
            if (this._monitorSignalId) {
                this._monitor.disconnect(this._monitorSignalId);
                this._monitorSignalId = 0;
            }
            this._monitor.cancel();
            this._monitor = null;
        }

        logger.info('Directory monitor stopped');
    }

    /**
     * Cleans up all resources and breaks references for garbage collection.
     */
    destroy() {
        this.stop();
        this._iconMatcher = null;
        this._settings = null;
        this._onLauncherUpdated = null;
    }

    /**
     * Handles Gio.FileMonitor event.
     */
    _onFileChanged(file, otherFile, eventType) {
        if (!this._isRunning) return;

        const filename = file.get_basename();
        if (!filename || !filename.endsWith('.desktop')) {
            // Immediately ignore unrelated files (.png, .tmp, mimeinfo.cache, etc.)
            return;
        }

        const filePath = file.get_path();

        // Handle deletion
        if (eventType === Gio.FileMonitorEvent.DELETED || eventType === Gio.FileMonitorEvent.MOVED_OUT) {
            this._cancelDebounce(filePath);
            const stateMgr = this._iconMatcher.getStateManager();
            if (stateMgr.hasEntry(filename)) {
                logger.debug(`Launcher deleted: ${filename}; removing state record`);
                stateMgr.removeEntry(filename);
            }
            return;
        }

        // Handle rename / move
        if (eventType === Gio.FileMonitorEvent.RENAMED || eventType === Gio.FileMonitorEvent.MOVED) {
            this._cancelDebounce(filePath);
            const stateMgr = this._iconMatcher.getStateManager();
            if (otherFile) {
                const otherPath = otherFile.get_path();
                const otherName = otherFile.get_basename();
                if (stateMgr.hasEntry(filename)) {
                    stateMgr.renameEntry(filename, otherName);
                }
                if (otherName.endsWith('.desktop')) {
                    this._scheduleDebounce(otherPath);
                }
            } else {
                if (stateMgr.hasEntry(filename)) {
                    stateMgr.removeEntry(filename);
                }
            }
            return;
        }

        // Handle creation / modification
        if (
            eventType === Gio.FileMonitorEvent.CREATED ||
            eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
            eventType === Gio.FileMonitorEvent.CHANGED ||
            eventType === Gio.FileMonitorEvent.MOVED_IN
        ) {
            // Check self-modification suppression
            if (this._iconMatcher.getFileWriter().isRecentSelfWrite(filePath)) {
                logger.debug(`Ignoring event caused by extension's own write: ${filename}`);
                return;
            }

            // Check if auto-matching newly installed PWAs is enabled
            if (this._settings && !this._settings.get_boolean('auto-match-new')) {
                return;
            }

            this._scheduleDebounce(filePath);
        }
    }

    _cancelDebounce(filePath) {
        const sourceId = this._pendingDebounces.get(filePath);
        if (sourceId) {
            GLib.Source.remove(sourceId);
            this._pendingDebounces.delete(filePath);
        }
    }

    _scheduleDebounce(filePath) {
        // Cancel superseded pending operation for the same file
        this._cancelDebounce(filePath);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._pendingDebounces.delete(filePath);
            if (!this._isRunning) return GLib.SOURCE_REMOVE;

            this._processFile(filePath).catch(err => {
                logger.error(`Error processing file ${filePath}`, err);
            });

            return GLib.SOURCE_REMOVE;
        });

        this._pendingDebounces.set(filePath, sourceId);
    }

    async _processFile(filePath) {
        try {
            const res = await this._iconMatcher.processDesktopFile(filePath);
            if (res && res.modified) {
                try {
                    Gio.Subprocess.new(['update-desktop-database', this._appsDir], Gio.SubprocessFlags.NONE);
                } catch (_) {}

                if (this._onLauncherUpdated) {
                    const basename = GLib.path_get_basename(filePath);
                    this._onLauncherUpdated(basename);
                }
            }
        } catch (err) {
            logger.error(`Failed to process ${filePath}`, err);
        }
    }

    /**
     * Performs a single asynchronous, bounded-batch pass over ~/.local/share/applications/
     * Resolves existing PWA launchers without blocking the GNOME Shell main loop.
     *
     * @returns {Promise<{ scannedCount: number, matchedCount: number }>}
     */
    async scanDirectoryOnce() {
        logger.info('Starting startup scan of user applications directory...');
        const dirFile = Gio.File.new_for_path(this._appsDir);
        if (!dirFile.query_exists(null)) {
            return { scannedCount: 0, matchedCount: 0 };
        }

        let scannedCount = 0;
        let matchedCount = 0;
        const seenFiles = [];

        let enumerator = null;
        try {
            const cancellable = this._cancellable || new Gio.Cancellable();
            enumerator = await new Promise((resolve, reject) => {
                dirFile.enumerate_children_async(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (obj, res) => {
                        try {
                            resolve(obj.enumerate_children_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            while (!cancellable.is_cancelled()) {
                const files = await new Promise((resolve, reject) => {
                    enumerator.next_files_async(
                        SCAN_BATCH_SIZE,
                        GLib.PRIORITY_DEFAULT,
                        cancellable,
                        (obj, res) => {
                            try {
                                resolve(obj.next_files_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                if (!files || files.length === 0) break;

                const batchDesktopFiles = [];
                for (const fileInfo of files) {
                    const name = fileInfo.get_name();
                    if (name.endsWith('.desktop')) {
                        seenFiles.push(name);
                        batchDesktopFiles.push(name);
                    }
                }
                scannedCount += batchDesktopFiles.length;

                // Process batch concurrently in parallel for aggressive speed
                const batchResults = await Promise.all(
                    batchDesktopFiles.map(async (name) => {
                        if (cancellable.is_cancelled()) return false;
                        const fullPath = GLib.build_filenamev([this._appsDir, name]);
                        try {
                            const result = await this._iconMatcher.processDesktopFile(fullPath);
                            if (result && result.modified) {
                                if (this._onLauncherUpdated) {
                                    this._onLauncherUpdated(name);
                                }
                                return true;
                            }
                        } catch (err) {
                            logger.error(`Error processing file during scan: ${name}`, err);
                        }
                        return false;
                    })
                );

                for (const modified of batchResults) {
                    if (modified) matchedCount++;
                }
            }

            // Only clean missing files if scan completed without cancellation
            if (!cancellable.is_cancelled()) {
                this._iconMatcher.getStateManager().cleanMissingFiles(seenFiles);
            }

            if (matchedCount > 0) {
                try {
                    Gio.Subprocess.new(['update-desktop-database', this._appsDir], Gio.SubprocessFlags.NONE);
                } catch (_) {}

                if (this._onLauncherUpdated) {
                    this._onLauncherUpdated(null);
                }
            }

            logger.info(`Startup scan complete: ${scannedCount} desktop files scanned, ${matchedCount} updated`);
        } catch (err) {
            if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                logger.debug('Startup scan cancelled');
            } else {
                logger.error('Error during startup scan', err);
            }
        } finally {
            if (enumerator) {
                try {
                    enumerator.close(null);
                } catch {}
            }
        }

        return { scannedCount, matchedCount };
    }

    /**
     * Rescans and re-evaluates all PWA desktop launchers.
     * Used on theme switch or manual sync to update newly available icons or trigger fallback.
     *
     * @returns {Promise<{ scannedCount: number, matchedCount: number }>}
     */
    async resyncAllLaunchers() {
        return this.scanDirectoryOnce();
    }
}
