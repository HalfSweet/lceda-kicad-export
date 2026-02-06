export function sanitizeName(name: string): string {
	return name.replace(/[^\w.-]/g, '_');
}

export function sanitizeFileName(name: string): string {
	return sanitizeName(name).replace(/^_+/, '').slice(0, 180) || 'export';
}

export function extractPrefix(designator?: string): string {
	if (!designator)
		return 'U';
	const match = designator.trim().match(/^[A-Z]+/i);
	if (!match)
		return 'U';
	return match[0].toUpperCase();
}

export function isLcscId(value?: string): value is string {
	if (!value)
		return false;
	return /^C\d+$/i.test(value.trim());
}

export function normalizeLcscId(value: string): string {
	return value.trim().toUpperCase();
}

export function extractLcscIds(text: string): string[] {
	const matches = text.toUpperCase().match(/C\d+/g) ?? [];
	const unique = new Set<string>();
	for (const m of matches) {
		if (/^C\d+$/.test(m))
			unique.add(m);
	}
	return [...unique];
}

export function formatTimestampForFile(date: Date): string {
	const pad2 = (n: number) => String(n).padStart(2, '0');
	return `${[
		String(date.getFullYear()),
		pad2(date.getMonth() + 1),
		pad2(date.getDate()),
	].join('')}_${
		[pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join('')}`;
}

export function shortenUuid(uuid: string, len = 6): string {
	const cleaned = uuid.replace(/[^a-f0-9]/gi, '');
	if (cleaned.length <= len)
		return cleaned.toLowerCase();
	return cleaned.slice(-len).toLowerCase();
}
