/**
 * PWA Icon Matcher - Safe Desktop Entry File Writer
 *
 * Provides atomic, safe modification restricted exclusively to authorized
 * user-owned application directories. Protects against concurrent modifications.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { patchDesktopEntryIcon, validateDesktopEntry } from './desktop-entry.js';
import { logger } from './logger.js';

export class FileWriter {
    /**
     * @param {string[]} [allowedDirectories] - Allowed base directories for writing
     */
    constructor(allowedDirectories = null) {
        if (allowedDirectories) {
            this._allowedDirs = allowedDirectories;
        } else {
            const userApps = GLib.build_filenamev([
                GLib.get_user_data_dir(),
                'applications'
            ]);
            this._allowedDirs = [userApps];
        }

        // Tracks recently modified files to prevent monitor feedback loops
        this._recentWrites = new Map();
    }

    destroy() {
        this._recentWrites.clear();
        this._allowedDirs = [];
    }

    /**
     * Checks whether a write occurred recently for this file path.
     *
     * @param {string} filePath
     * @returns {boolean}
     */
    isRecentSelfWrite(filePath) {
        const lastWrite = this._recentWrites.get(filePath);
        if (!lastWrite) return false;

        const age = Date.now() - lastWrite;
        if (age < 2500) {
            return true;
        }

        this._recentWrites.delete(filePath);
        return false;
    }

    /**
     * Registers a write timestamp.
     */
    markRecentWrite(filePath) {
        this._recentWrites.set(filePath, Date.now());

        // Prune older records
        const now = Date.now();
        for (const [path, time] of this._recentWrites.entries()) {
            if (now - time > 10000) {
                this._recentWrites.delete(path);
            }
        }
    }

    /**
     * Verifies that target file is located inside an authorized directory.
     * Rejects system paths like /usr, /etc, or parent traversal.
     *
     * @param {string} filePath
     * @returns {boolean}
     */
    isPathAllowed(filePath) {
        if (!filePath || typeof filePath !== 'string') return false;

        // Reject system root locations outright
        if (filePath.startsWith('/usr/') || filePath.startsWith('/etc/') || filePath.startsWith('/var/')) {
            return false;
        }

        // Canonicalize path
        const file = Gio.File.new_for_path(filePath);
        const resolvedPath = file.get_path();
        if (!resolvedPath) return false;

        const pathAllowed = this._allowedDirs.some(dir => {
            const dirFile = Gio.File.new_for_path(dir);
            const resolvedDir = dirFile.get_path();
            return resolvedPath.startsWith(resolvedDir + '/') || resolvedPath === resolvedDir;
        });

        if (!pathAllowed) return false;

        // Security check: if file is a symlink, verify target also resides in allowed directories
        try {
            if (file.query_exists(null)) {
                const info = file.query_info(
                    'standard::is-symlink,standard::symlink-target',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    null
                );
                if (info && info.get_is_symlink()) {
                    const target = info.get_symlink_target();
                    const parentDir = file.get_parent();
                    const targetFile = parentDir ? parentDir.resolve_relative_path(target) : Gio.File.new_for_path(target);
                    const targetPath = targetFile ? targetFile.get_path() : null;
                    const targetAllowed = targetPath && this._allowedDirs.some(dir => {
                        const dirFile = Gio.File.new_for_path(dir);
                        const resolvedDir = dirFile.get_path();
                        return targetPath.startsWith(resolvedDir + '/') || targetPath === resolvedDir;
                    });
                    if (!targetAllowed) {
                        logger.warn(`Rejected symlink pointing outside allowed directory: ${filePath} -> ${target}`);
                        return false;
                    }
                }
            }
        } catch {
            // Non-critical check failure; query_info might fail if file doesn't exist
        }

        return true;
    }

    /**
     * Atomically updates the Icon= key in a desktop file.
     *
     * @param {string} filePath - Absolute path to desktop file
     * @param {string} newIcon - New icon theme name
     * @param {string} [expectedOriginalContent] - Content when read, to prevent concurrent overwrite
     * @returns {Promise<{ success: boolean, originalContent?: string, error?: string }>}
     */
    async updateIcon(filePath, newIcon, expectedOriginalContent = null) {
        if (!this.isPathAllowed(filePath)) {
            const err = `Modification rejected: path "${filePath}" is outside authorized user directories`;
            logger.warn(err);
            return { success: false, error: err };
        }

        const file = Gio.File.new_for_path(filePath);
        if (!file.query_exists(null)) {
            const err = `File does not exist: "${filePath}"`;
            logger.warn(err);
            return { success: false, error: err };
        }

        try {
            // Read current contents
            const [success, contents, etag] = file.load_contents(null);
            if (!success || !contents) {
                return { success: false, error: 'Failed to read file contents' };
            }

            const decoder = new TextDecoder('utf-8');
            const currentContent = decoder.decode(contents);

            // Concurrency check: If expected content was provided, verify it hasn't changed
            if (expectedOriginalContent !== null && currentContent !== expectedOriginalContent) {
                const err = 'File was modified concurrently on disk; aborting to avoid overwriting newer data';
                logger.warn(`${err}: ${filePath}`);
                return { success: false, error: err, concurrentChange: true };
            }

            // Patch only Icon= line
            const patched = patchDesktopEntryIcon(currentContent, newIcon);

            // Validate modified desktop entry structure before writing
            if (!validateDesktopEntry(patched)) {
                const err = 'Patched desktop entry failed structural validation; aborting write';
                logger.error(err);
                return { success: false, error: err };
            }

            // If contents didn't change (e.g. already had this icon)
            if (patched === currentContent) {
                return { success: true, originalContent: currentContent, noChange: true };
            }

            // Register self-write before replacing
            this.markRecentWrite(filePath);

            // Atomic file write using Gio.File.replace_contents
            const encoder = new TextEncoder();
            const bytes = encoder.encode(patched);

            file.replace_contents(
                bytes,
                etag || null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            logger.info(`Updated icon to "${newIcon}" in ${file.get_basename()}`);
            return { success: true, originalContent: currentContent };
        } catch (err) {
            logger.error(`Error writing file "${filePath}"`, err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Restores an original icon value to a desktop file.
     *
     * @param {string} filePath
     * @param {string} originalIcon
     * @param {string} expectedCurrentIcon - Must match expectedCurrentIcon to avoid overwriting user edits
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async restoreIcon(filePath, originalIcon, expectedCurrentIcon) {
        if (!this.isPathAllowed(filePath)) {
            return { success: false, error: 'Path not allowed' };
        }

        const file = Gio.File.new_for_path(filePath);
        if (!file.query_exists(null)) {
            return { success: false, error: 'File does not exist' };
        }

        try {
            const [success, contents, etag] = file.load_contents(null);
            if (!success || !contents) {
                return { success: false, error: 'Failed to read file' };
            }

            const decoder = new TextDecoder('utf-8');
            const currentContent = decoder.decode(contents);

            // Check current icon in file
            const lines = currentContent.split(/\r?\n/);
            let inDesktopEntry = false;
            let currentIconInFile = '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    inDesktopEntry = (trimmed === '[Desktop Entry]');
                    continue;
                }
                if (inDesktopEntry && /^Icon\s*=/.test(trimmed)) {
                    currentIconInFile = trimmed.substring(trimmed.indexOf('=') + 1).trim();
                    break;
                }
            }

            // Only restore if icon still equals what our extension matched
            if (expectedCurrentIcon && currentIconInFile !== expectedCurrentIcon) {
                const err = `Icon in ${file.get_basename()} was modified externally (${currentIconInFile} != ${expectedCurrentIcon}); skipping restoration`;
                logger.warn(err);
                return { success: false, error: err, externallyModified: true };
            }

            // Patch back to original
            const patched = patchDesktopEntryIcon(currentContent, originalIcon);

            if (!validateDesktopEntry(patched)) {
                return { success: false, error: 'Restored content failed validation' };
            }

            this.markRecentWrite(filePath);

            const encoder = new TextEncoder();
            const bytes = encoder.encode(patched);

            file.replace_contents(
                bytes,
                etag || null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            logger.info(`Restored original icon for ${file.get_basename()}`);
            return { success: true };
        } catch (err) {
            logger.error(`Error restoring icon for "${filePath}"`, err);
            return { success: false, error: err.message };
        }
    }
}
