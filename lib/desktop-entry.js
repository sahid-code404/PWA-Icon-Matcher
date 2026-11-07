/**
 * PWA Icon Matcher - Desktop Entry Parser and Minimal Patcher
 *
 * Adheres strictly to the Desktop Entry Specification.
 * Performs surgical patching of only the Icon= key in [Desktop Entry],
 * preserving comments, formatting, line endings, action groups, and ordering.
 */

import GLib from 'gi://GLib';

/**
 * Tokenizes an Exec line according to the Desktop Entry Specification.
 * Handles quoting, backslash escaping, and field codes without shell execution.
 *
 * @param {string} execStr
 * @returns {string[]} parsed arguments
 */
export function parseExecArgs(execStr) {
    if (!execStr || typeof execStr !== 'string') return [];

    const args = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let escape = false;

    const len = execStr.length;
    for (let i = 0; i < len; i++) {
        const char = execStr[i];

        if (escape) {
            current += char;
            escape = false;
            continue;
        }

        if (char === '\\') {
            escape = true;
            continue;
        }

        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inQuote = true;
            quoteChar = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current.length > 0) {
                args.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (current.length > 0) {
        args.push(current);
    }

    // Filter out Desktop Entry field codes (%f, %F, %u, %U, %d, %D, %n, %N, %i, %c, %k, %v, %m)
    return args
        .filter(arg => !/^%[a-zA-Z%]$/.test(arg))
        .map(arg => arg.replace(/%%/g, '%'));
}

/**
 * Parses a desktop file string and extracts the main [Desktop Entry] key-value pairs.
 *
 * @param {string} content
 * @returns {{
 *   isValid: boolean,
 *   keys: Map<string, string>,
 *   name: string,
 *   exec: string,
 *   icon: string,
 *   startupWmClass: string,
 *   type: string,
 *   actions: string[],
 *   lineEnding: string
 * }}
 */
export function parseDesktopEntry(content) {
    const result = {
        isValid: false,
        keys: new Map(),
        name: '',
        exec: '',
        icon: '',
        startupWmClass: '',
        type: '',
        actions: [],
        lineEnding: content.includes('\r\n') ? '\r\n' : '\n'
    };

    if (!content || typeof content !== 'string') return result;

    const lines = content.split(/\r?\n/);
    let inDesktopEntry = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Skip blank lines and comments for key extraction
        if (!line || line.startsWith('#')) continue;

        if (line.startsWith('[') && line.endsWith(']')) {
            if (line === '[Desktop Entry]') {
                inDesktopEntry = true;
                result.isValid = true;
            } else {
                inDesktopEntry = false;
            }
            continue;
        }

        if (inDesktopEntry) {
            const eqIdx = line.indexOf('=');
            if (eqIdx !== -1) {
                const key = line.substring(0, eqIdx).trim();
                const value = line.substring(eqIdx + 1).trim();
                result.keys.set(key, value);
            }
        }
    }

    if (result.isValid) {
        result.name = result.keys.get('Name') || '';
        result.exec = result.keys.get('Exec') || '';
        result.icon = result.keys.get('Icon') || '';
        result.startupWmClass = result.keys.get('StartupWMClass') || '';
        result.type = result.keys.get('Type') || '';

        const actionsVal = result.keys.get('Actions') || '';
        if (actionsVal) {
            result.actions = actionsVal.split(';').map(a => a.trim()).filter(Boolean);
        }
    }

    return result;
}

/**
 * Surgically updates ONLY the Icon= key in the [Desktop Entry] group.
 * Preserves all comments, ordering, action groups, whitespace, and line endings.
 *
 * @param {string} content - Original desktop file content
 * @param {string} newIcon - The replacement icon name
 * @returns {string} - Modified desktop file content
 */
export function patchDesktopEntryIcon(content, newIcon) {
    if (!content || typeof content !== 'string') return content;

    const crlf = content.includes('\r\n');
    const eol = crlf ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);

    const newLines = [];
    let inDesktopEntry = false;
    let iconReplaced = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            if (trimmed === '[Desktop Entry]') {
                inDesktopEntry = true;
            } else {
                if (inDesktopEntry && !iconReplaced) {
                    newLines.push(`Icon=${newIcon}`);
                    iconReplaced = true;
                }
                inDesktopEntry = false;
            }
            newLines.push(line);
            continue;
        }

        if (inDesktopEntry && /^Icon\s*=/.test(trimmed)) {
            newLines.push(`Icon=${newIcon}`);
            iconReplaced = true;
            continue;
        }

        newLines.push(line);
    }

    // If EOF was reached while still in [Desktop Entry] and Icon wasn't replaced
    if (inDesktopEntry && !iconReplaced) {
        newLines.push(`Icon=${newIcon}`);
        iconReplaced = true;
    }

    let result = newLines.join(eol);
    if (content.endsWith('\n') || content.endsWith('\r\n')) {
        result += eol;
    }

    return result;
}

/**
 * Validates desktop entry structure using GLib.KeyFile.
 *
 * @param {string} content
 * @returns {boolean} true if valid
 */
export function validateDesktopEntry(content) {
    if (!content || !content.includes('[Desktop Entry]')) return false;
    try {
        const keyFile = new GLib.KeyFile();
        const bytes = new TextEncoder().encode(content);
        keyFile.load_from_data(content, bytes.length, GLib.KeyFileFlags.NONE);
        if (!keyFile.has_group('Desktop Entry')) return false;
        try {
            const name = keyFile.get_string('Desktop Entry', 'Name');
            return Boolean(name && name.length > 0);
        } catch {
            return false;
        }
    } catch {
        return false;
    }
}
