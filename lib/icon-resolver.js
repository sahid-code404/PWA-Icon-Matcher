/**
 * PWA Icon Matcher - Icon Resolver and Normalization Engine
 *
 * Implements deterministic name normalization and active icon theme lookup
 * following the strict priority order and safety constraints from the spec.
 */

import Gio from 'gi://Gio';
import { logger } from './logger.js';

/**
 * Normalizes an application name into a clean, canonical icon name.
 *
 * Rules:
 * - Safe Unicode normalization (NFKD/NFC).
 * - Case folding to lowercase.
 * - Replace separators (spaces, underscores, slashes, dots) with hyphens.
 * - Remove characters other than lowercase letters, numbers, and hyphens.
 * - Collapse consecutive hyphens and strip leading/trailing hyphens.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeAppName(name) {
    if (!name || typeof name !== 'string') return '';

    return name
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[\s_./+]+/gu, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/-+/gu, '-')
        .replace(/^-+|-+$/gu, '');
}

/**
 * Well-known fallback mappings for common web apps where the web app
 * title commonly includes a "Web" or "App" suffix while the icon theme
 * provides the canonical brand name.
 */
const KNOWN_FALLBACK_MAPPINGS = new Map([
    ['whatsapp-web', 'whatsapp'],
    ['telegram-web', 'telegram'],
    ['slack-web', 'slack'],
    ['discord-web', 'discord'],
    ['twitter-web', 'twitter'],
    ['x-web', 'x'],
    ['instagram-web', 'instagram'],
    ['facebook-web', 'facebook'],
    ['messenger-web', 'facebook-messenger'],
    ['reddit-web', 'reddit'],
    ['notion-web', 'notion'],
    ['spotify-web', 'spotify'],
    ['chatgpt-web', 'chatgpt'],
    ['claude-web', 'claude'],
    ['gmail-web', 'gmail'],
    ['google-docs-web', 'google-docs'],
    ['google-sheets-web', 'google-sheets'],
    ['google-drive-web', 'google-drive'],
    ['google-meet-web', 'google-meet'],
    ['github-web', 'github'],
    ['youtube-web', 'youtube'],
    ['teams-web', 'teams'],
    ['microsoft-teams-web', 'microsoft-teams'],
    ['outlook-web', 'outlook'],
    ['zoom-web', 'zoom'],
    ['skype-web', 'skype']
]);

export class IconResolver {
    /**
     * @param {object} [themeBackend] - St.IconTheme or Gtk.IconTheme instance
     * @param {Gio.Settings} [settings] - Extension GSettings instance
     */
    constructor(themeBackend = null, settings = null) {
        this._themeBackend = themeBackend;
        this._settings = settings;
        this._desktopSettings = null;
        this._initDesktopSettings();
    }

    _initDesktopSettings() {
        try {
            this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        } catch {
            // May fail in isolated test environments
        }
    }

    setThemeBackend(backend) {
        this._themeBackend = backend;
    }

    async getThemeBackend() {
        if (this._themeBackend) {
            return this._themeBackend;
        }

        try {
            const St = (await import('gi://St')).default;
            this._themeBackend = new St.IconTheme();
            return this._themeBackend;
        } catch {
            try {
                const Gtk = (await import('gi://Gtk?version=4.0')).default;
                Gtk.init();
                const theme = new Gtk.IconTheme();
                if (this._desktopSettings) {
                    try {
                        const themeName = this._desktopSettings.get_string('icon-theme');
                        if (themeName) theme.set_theme_name(themeName);
                    } catch {}
                }
                this._themeBackend = theme;
                return this._themeBackend;
            } catch (err) {
                logger.error('Failed to initialize icon theme backend', err);
                return null;
            }
        }
    }

    /**
     * Checks whether an icon name exists in the active icon theme.
     *
     * @param {string} iconName
     * @returns {Promise<boolean>}
     */
    async hasThemeIcon(iconName) {
        if (!iconName) return false;
        const theme = await this.getThemeBackend();
        if (!theme) return false;

        try {
            if (typeof theme.rescan_if_needed === 'function') {
                theme.rescan_if_needed();
            }
            return Boolean(theme.has_icon(iconName));
        } catch (err) {
            logger.error(`Error querying icon theme for "${iconName}"`, err);
            return false;
        }
    }

    /**
     * Synchronous check if theme backend is already loaded.
     */
    hasThemeIconSync(iconName) {
        if (!iconName || !this._themeBackend) return false;
        try {
            if (typeof this._themeBackend.rescan_if_needed === 'function') {
                this._themeBackend.rescan_if_needed();
            }
            return Boolean(this._themeBackend.has_icon(iconName));
        } catch {
            return false;
        }
    }

    /**
     * Generates ordered candidate icon names for an application.
     *
     * Priority:
     * 1. Explicit user-defined icon alias (from GSettings custom-aliases)
     * 2. Exact PWA application identifier mapping (if configured)
     * 3. Exact normalized desktop application name
     * 4. Normalized variations (hyphen-free, underscore)
     * 5. Explicitly configured fallback mapping (for known Web suffixes)
     *
     * @param {string} appName
     * @param {string} [appId]
     * @returns {string[]} Ordered candidate icon names
     */
    getCandidates(appName, appId = '') {
        const candidates = [];
        const seen = new Set();

        const addCandidate = (cand) => {
            if (cand && !seen.has(cand)) {
                seen.add(cand);
                candidates.push(cand);
            }
        };

        // 1. Explicit user-defined icon alias
        if (this._settings) {
            try {
                const aliasesVar = this._settings.get_value('custom-aliases');
                const aliases = aliasesVar.deepUnpack ? aliasesVar.deepUnpack() : {};
                if (appName && aliases[appName]) {
                    addCandidate(aliases[appName]);
                }
                if (appId && aliases[appId]) {
                    addCandidate(aliases[appId]);
                }
            } catch (err) {
                logger.error('Error reading custom-aliases setting', err);
            }
        }

        // 2. Exact PWA application identifier mapping (if meaningful appId provided)
        if (appId && typeof appId === 'string') {
            const normalizedAppId = normalizeAppName(appId);
            // Skip random 32-char hex/alpha hashes like chrome crx hashes, but keep human-readable IDs
            if (normalizedAppId && !/^[a-p]{32}$/.test(normalizedAppId) && !/^[0-9a-f]{32,}$/.test(normalizedAppId)) {
                addCandidate(normalizedAppId);
            }
        }

        // 3. Exact normalized desktop application name
        const normalized = normalizeAppName(appName);
        if (normalized) {
            addCandidate(normalized);
        }

        // 4. Recognized browser launcher identifier / variation without hyphens
        if (normalized && normalized.includes('-')) {
            const noHyphens = normalized.replace(/-/g, '');
            if (noHyphens.length >= 3) {
                addCandidate(noHyphens);
            }
        }

        // 5. Explicitly configured fallback mapping (e.g. "whatsapp-web" -> "whatsapp")
        if (normalized && KNOWN_FALLBACK_MAPPINGS.has(normalized)) {
            addCandidate(KNOWN_FALLBACK_MAPPINGS.get(normalized));
        }

        return candidates;
    }

    /**
     * Resolves the best matching icon name present in the active icon theme.
     * Returns null if no theme icon exists or if matching is ambiguous.
     *
     * @param {string} appName
     * @param {string} [appId]
     * @returns {Promise<string|null>}
     */
    async resolveIcon(appName, appId = '') {
        const candidates = this.getCandidates(appName, appId);
        if (candidates.length === 0) return null;

        for (const candidate of candidates) {
            if (await this.hasThemeIcon(candidate)) {
                logger.debug(`Resolved icon for "${appName}": ${candidate}`);
                return candidate;
            }
        }

        logger.debug(`No active theme icon found for "${appName}" (candidates: ${candidates.join(', ')})`);
        return null;
    }
}
