/**
 * RFC-4180 compliant CSV parser and stringifier with zero external dependencies.
 */

/**
 * Parses a CSV string into an array of row objects keyed by the headers.
 *
 * @param {string} text - Raw CSV content
 * @param {Object} [options]
 * @param {string[]} [options.requiredColumns] - Required header names
 * @returns {Array<Object<string, string>>}
 */
export function parseCsv(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('CSV content must be a string');
  }

  const rawRows = tokenizeCsv(text);
  if (rawRows.length === 0) {
    return [];
  }

  // Filter out full-line comments starting with '#'
  const rows = rawRows.filter(r => !(r.length > 0 && r[0].trim().startsWith('#')));
  if (rows.length === 0) {
    return [];
  }

  // Extract and clean headers
  const rawHeaders = rows[0].map(h => h.trim());
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[\s-]+/g, '_'));

  if (options.requiredColumns && options.requiredColumns.length > 0) {
    const missing = options.requiredColumns.filter(col => {
      const normalizedCol = col.toLowerCase().replace(/[\s-]+/g, '_');
      return !headers.includes(normalizedCol);
    });
    if (missing.length > 0) {
      throw new Error(`CSV is missing required column(s): ${missing.join(', ')}. Found: ${rawHeaders.join(', ')}`);
    }
  }

  const results = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip empty lines (all columns blank)
    if (row.length === 1 && row[0].trim() === '') {
      continue;
    }
    const item = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = c < row.length ? row[c] : '';
      item[key] = val.trim();
    }
    // Also attach original 1-indexed row number
    item.__rowNum = r + 1;
    results.push(item);
  }

  return results;
}

/**
 * Tokenizes a CSV string into a 2D array of strings.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function tokenizeCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      if (nextChar === '\n') {
        i++; // skip \r of \r\n
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  // Push final field/row if any data remains
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Converts an array of objects into an RFC-4180 CSV string.
 *
 * @param {Array<Object>} records
 * @param {string[]} columns - Ordered column keys
 * @returns {string}
 */
export function stringifyCsv(records, columns) {
  if (!Array.isArray(records) || records.length === 0) {
    return columns.join(',') + '\r\n';
  }

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const headerLine = columns.map(escapeCell).join(',');
  const lines = [headerLine];

  for (const record of records) {
    const row = columns.map(col => escapeCell(record[col]));
    lines.push(row.join(','));
  }

  return lines.join('\r\n') + '\r\n';
}
