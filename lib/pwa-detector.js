/**
 * PWA Icon Matcher - PWA Detector
 *
 * Coordinates modular browser adapters to determine whether a given
 * desktop entry is a browser-generated PWA launcher.
 */

import { parseDesktopEntry } from './desktop-entry.js';
import { createDefaultAdapters } from './browser-adapters.js';
import { logger } from './logger.js';

export class PwaDetector {
    /**
     * @param {Gio.Settings|null} settings - GSettings object for checking enabled adapters
     * @param {Array<BrowserAdapter>} [adapters] - Optional adapter list override
     */
    constructor(settings = null, adapters = null) {
        this._settings = settings;
        this._adapters = adapters || createDefaultAdapters();
    }

    /**
     * Checks if a desktop entry is a supported PWA launcher.
     *
     * @param {string|object} contentOrParsed - Raw string or already parsed desktop entry
     * @param {string} filename - Filename of desktop entry (e.g. brave-xxx-Default.desktop)
     * @returns {{
     *   isPwa: boolean,
     *   browserId?: string,
     *   browserName?: string,
     *   appName?: string,
     *   appId?: string,
     *   originalIcon?: string
     * }}
     */
    detect(contentOrParsed, filename) {
        const parsed = typeof contentOrParsed === 'string'
            ? parseDesktopEntry(contentOrParsed)
            : contentOrParsed;

        if (!parsed || !parsed.isValid) {
            return { isPwa: false };
        }

        // Must be an Application
        if (parsed.type && parsed.type !== 'Application') {
            return { isPwa: false };
        }

        if (!parsed.name || !parsed.exec) {
            return { isPwa: false };
        }

        const browserIndependent = this._settings
            ? this._settings.get_boolean('browser-independent')
            : true;

        for (const adapter of this._adapters) {
            // Check if adapter is enabled in settings
            if (this._settings) {
                if (!browserIndependent && adapter.id !== 'brave' && adapter.id !== 'chrome') {
                    continue;
                }
                if (!this._settings.get_boolean(adapter.settingKey)) {
                    continue;
                }
            }

            try {
                const match = adapter.match(parsed, filename);
                if (match && match.matched) {
                    logger.debug(`Matched PWA launcher "${parsed.name}" with adapter: ${match.browserName}`);
                    return {
                        isPwa: true,
                        browserId: match.browserId,
                        browserName: match.browserName,
                        appName: match.appName,
                        appId: match.appId,
                        originalIcon: parsed.icon
                    };
                }
            } catch (err) {
                logger.error(`Error matching adapter ${adapter.name}`, err);
            }
        }

        return { isPwa: false };
    }
}
