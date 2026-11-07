/**
 * PWA Icon Matcher - Lightweight Diagnostic Logger
 *
 * Provides safe, bounded in-memory diagnostic logging with optional
 * GLib/journal logging. Never logs sensitive browsing URLs or user secrets.
 */

const MAX_BUFFER_SIZE = 150;

class Logger {
    constructor() {
        this._debugEnabled = false;
        this._buffer = [];
    }

    setDebugEnabled(enabled) {
        this._debugEnabled = Boolean(enabled);
    }

    isDebugEnabled() {
        return this._debugEnabled;
    }

    _record(level, message) {
        const timestamp = new Date().toISOString().substring(11, 19);
        const entry = `[${timestamp}] [${level}] ${message}`;

        this._buffer.push(entry);
        if (this._buffer.length > MAX_BUFFER_SIZE) {
            this._buffer.shift();
        }

        return entry;
    }

    debug(message) {
        if (!this._debugEnabled) return;
        const entry = this._record('DEBUG', message);
        console.log(`[PWA Icon Matcher] ${entry}`);
    }

    info(message) {
        const entry = this._record('INFO', message);
        if (this._debugEnabled) {
            console.log(`[PWA Icon Matcher] ${entry}`);
        }
    }

    warn(message) {
        const entry = this._record('WARN', message);
        console.warn(`[PWA Icon Matcher] ${entry}`);
    }

    error(message, error = null) {
        const errDetail = error ? ` - ${error.message || error}` : '';
        const entry = this._record('ERROR', `${message}${errDetail}`);
        console.error(`[PWA Icon Matcher] ${entry}`);
    }

    getRecentLogs() {
        return [...this._buffer];
    }

    clearLogs() {
        this._buffer = [];
    }
}

export const logger = new Logger();
