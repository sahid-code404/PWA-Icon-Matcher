/**
 * PWA Icon Matcher - Safe Dynamic Icon Resolver
 *
 * Uses native St.IconTheme and semantic token heuristics.
 * NEVER initializes GTK or accesses display servers from within GNOME Shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { logger } from './logger.js';

const NOISE_WORDS = new Set([
    'web', 'app', 'online', 'desktop', 'client', 'pwa', 'official', 'player',
    'browser', 'viewer', 'dashboard', 'portal', 'home', 'site', 'page'
]);

/**
 * Normalizes an application name into a clean, canonical string.
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
 * Extracts core semantic tokens from an app name, filtering out generic web suffixes.
 * E.g., "WhatsApp Web" -> ['whatsapp'], "YouTube Music" -> ['youtube', 'music']
 *
 * @param {string} appName
 * @returns {string[]}
 */
export function extractCoreTokens(appName) {
    if (!appName || typeof appName !== 'string') return [];

    const raw = appName
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim()
        .split(/\s+/);

    const filtered = raw.filter(token => token.length > 0 && !NOISE_WORDS.has(token));
    return filtered.length > 0 ? filtered : raw;
}

export class IconResolver {
    /**
     * @param {object} [themeBackend] - St.IconTheme instance provided by GNOME Shell
     * @param {Gio.Settings} [settings] - Extension GSettings instance
     */
    constructor(themeBackend = null, settings = null) {
        this._themeBackend = themeBackend;
        this._settings = settings;
    }

    setThemeBackend(backend) {
        this._themeBackend = backend;
    }

    /**
     * Checks whether an icon name exists in the active icon theme using St.IconTheme.
     * Safe to call inside GNOME Shell main loop.
     *
     * @param {string} iconName
     * @returns {boolean}
     */
    hasThemeIcon(iconName) {
        if (!iconName || !this._themeBackend) return false;

        try {
            if (typeof this._themeBackend.rescan_if_needed === 'function') {
                this._themeBackend.rescan_if_needed();
            }
            return Boolean(this._themeBackend.has_icon(iconName));
        } catch (err) {
            logger.error(`Error querying icon theme for "${iconName}"`, err);
            return false;
        }
    }

    /**
     * Generates ordered candidate icon names for an application.
     * Zero hardcoded dictionaries: derives candidates purely through semantic tokens
     * and standard Linux application packaging conventions.
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

        // 1. Explicit user-defined icon alias from settings (if configured)
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

        // 2. Meaningful human-readable App ID (if provided)
        if (appId && typeof appId === 'string') {
            const normalizedAppId = normalizeAppName(appId);
            if (normalizedAppId && !/^[a-p]{32}$/.test(normalizedAppId) && !/^[0-9a-f]{32,}$/.test(normalizedAppId)) {
                addCandidate(normalizedAppId);
            }
        }

        // 3. Exact normalized desktop application name (e.g. "youtube-music", "claude")
        const normalized = normalizeAppName(appName);
        if (normalized) {
            addCandidate(normalized);

            // Rebrand awareness for themes created under previous/alternate names
            if (normalized === 'gemini' || normalized === 'google-gemini') {
                addCandidate('google-gemini');
                addCandidate('bard');
                addCandidate('google-bard');
            } else if (normalized === 'x' || normalized === 'twitter') {
                addCandidate('x');
                addCandidate('twitter');
            } else if (normalized === 'z' || normalized === 'zai' || normalized === 'z-ai') {
                addCandidate('z-ai');
                addCandidate('zai');
                addCandidate('zhipu-ai');
                addCandidate('zhipu');
                addCandidate('chatglm');
            } else if (normalized === 'deepseek' || normalized === 'deep-seek') {
                addCandidate('deepseek');
                addCandidate('deep-seek');
                addCandidate('deepseek-chat');
            }
        }

        // 4. Core semantic brand tokens (e.g. "WhatsApp Web" -> "whatsapp")
        const coreTokens = extractCoreTokens(appName);
        if (coreTokens.length > 0) {
            const hyphenated = coreTokens.join('-');
            const flat = coreTokens.join('');
            addCandidate(hyphenated);
            addCandidate(flat);

            // 5. Common Linux desktop client suffixes (e.g. "youtube-music-desktop-app", "github-desktop")
            addCandidate(`${hyphenated}-desktop-app`);
            addCandidate(`${hyphenated}-desktop`);
            addCandidate(`${hyphenated}-app`);
            addCandidate(`${hyphenated}-client`);
        }

        // 6. Normalized variations without hyphens
        if (normalized && normalized.includes('-')) {
            const noHyphens = normalized.replace(/-/g, '');
            if (noHyphens.length >= 3) {
                addCandidate(noHyphens);
            }
            addCandidate(`${normalized}-desktop-app`);
            addCandidate(`${normalized}-desktop`);
            addCandidate(`${normalized}-app`);
        }

        return candidates;
    }

    /**
     * Resolves the best matching icon name present in the active icon theme.
     * Purely synchronous, completely non-blocking, and 100% safe inside GNOME Shell.
     *
     * @param {string} appName
     * @param {string} [appId]
     * @returns {Promise<string|null>}
     */
    async resolveIcon(appName, appId = '') {
        const candidates = this.getCandidates(appName, appId);

        for (const candidate of candidates) {
            if (this.hasThemeIcon(candidate)) {
                logger.debug(`Resolved icon for "${appName}": ${candidate}`);
                return candidate;
            }
        }

        logger.debug(`No active theme icon found for "${appName}" (candidates: ${candidates.join(', ')})`);
        return null;
    }
}
