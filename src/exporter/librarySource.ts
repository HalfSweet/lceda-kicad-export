export type LibraryDocumentType = '2' | '4'; // ELIB_LibraryType.SYMBOL | ELIB_LibraryType.FOOTPRINT

export const LIB_SYMBOL: LibraryDocumentType = '2';
export const LIB_FOOTPRINT: LibraryDocumentType = '4';

async function openTabAndGetSource(openTab: () => Promise<string | undefined>): Promise<string> {
	let tabId: string | undefined;
	try {
		tabId = await openTab();
		if (!tabId) {
			throw new Error('open document tab failed');
		}

		await eda.dmt_EditorControl.activateDocument(tabId);
		const source = await eda.sys_FileManager.getDocumentSource();
		if (typeof source !== 'string' || !source.trim()) {
			throw new Error('getDocumentSource returned empty');
		}
		return source;
	}
	finally {
		if (tabId) {
			try {
				await eda.dmt_EditorControl.closeDocument(tabId);
			}
			catch {}
		}
	}
}

export async function openLibraryAndGetSource(
	libraryUuid: string,
	libraryType: LibraryDocumentType,
	uuid: string,
): Promise<string> {
	return await openTabAndGetSource(async () => await eda.dmt_EditorControl.openLibraryDocument(libraryUuid, libraryType as any, uuid));
}

export async function openLibraryAndGetSourceByLibraryApi(
	libraryUuid: string,
	libraryType: LibraryDocumentType,
	uuid: string,
): Promise<string> {
	return await openTabAndGetSource(async () => {
		if (libraryType === LIB_SYMBOL) {
			return await eda.lib_Symbol.openInEditor(uuid, libraryUuid);
		}
		return await eda.lib_Footprint.openInEditor(uuid, libraryUuid);
	});
}

export interface ExtractedHeadAndShape {
	head: any;
	shape: string[];
}

function tryParseJsonString(value: string): unknown | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const first = trimmed[0];
	if (first !== '{' && first !== '[' && first !== '"') {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	}
	catch {
		return undefined;
	}
}

interface PipeSourceSegments {
	raw: string[];
	parsed: unknown[];
}

function parsePipeSource(value: string): PipeSourceSegments | undefined {
	if (!value.includes('||')) {
		return undefined;
	}
	const raw = value
		.split('||')
		.map(item => item.trim())
		.filter(Boolean);
	if (raw.length < 2) {
		return undefined;
	}
	const parsed = raw.map(item => tryParseJsonString(item) ?? item);
	return { raw, parsed };
}

function normalizeShape(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
		return list.length > 0 ? list : undefined;
	}
	if (typeof value === 'string') {
		const asJson = tryParseJsonString(value);
		if (Array.isArray(asJson)) {
			const list = asJson.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
			if (list.length > 0) {
				return list;
			}
		}
		const lines = value
			.split(/\r?\n/u)
			.map(line => line.trim())
			.filter(Boolean);
		return lines.length > 0 ? lines : undefined;
	}
	return undefined;
}

function normalizeHead(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value === 'string') {
		const parsed = tryParseJsonString(value);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	}
	return undefined;
}

function toHeadAndShape(value: unknown): ExtractedHeadAndShape | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = value as any;
	const head = normalizeHead(candidate.head);
	if (!head) {
		return undefined;
	}
	const shape = normalizeShape(candidate.shape);
	if (!shape) {
		return undefined;
	}
	return {
		head,
		shape,
	};
}

function findHeadAndShape(value: unknown, depth: number): ExtractedHeadAndShape | undefined {
	if (depth <= 0) {
		return undefined;
	}
	const direct = toHeadAndShape(value);
	if (direct) {
		return direct;
	}

	if (typeof value === 'string') {
		const parsed = tryParseJsonString(value);
		if (!parsed) {
			return undefined;
		}
		return findHeadAndShape(parsed, depth - 1);
	}

	if (!value || typeof value !== 'object') {
		return undefined;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findHeadAndShape(item, depth - 1);
			if (found)
				return found;
		}
		return undefined;
	}

	for (const child of Object.values(value as Record<string, unknown>)) {
		const found = findHeadAndShape(child, depth - 1);
		if (found)
			return found;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractFromPipeSegments(segments: PipeSourceSegments): ExtractedHeadAndShape | undefined {
	const byTree = findHeadAndShape(segments.parsed, 8);
	if (byTree) {
		return byTree;
	}

	const headIndex = segments.parsed.findIndex((item) => {
		return isRecord(item) && typeof item.docType === 'string';
	});
	if (headIndex < 0) {
		return undefined;
	}

	const head = segments.parsed[headIndex];
	if (!isRecord(head)) {
		return undefined;
	}

	const directShape = normalizeShape(head.shape);
	if (directShape) {
		return { head, shape: directShape };
	}

	const shape: string[] = [];
	for (let i = headIndex + 1; i < segments.raw.length; i++) {
		const raw = segments.raw[i];
		if (!raw) {
			continue;
		}
		const parsed = segments.parsed[i];
		if (isRecord(parsed)) {
			if (parsed.type === 'DOCTAIL' || parsed.type === 'DOCHEAD') {
				continue;
			}
			const fromShape = normalizeShape(parsed.shape);
			if (fromShape?.length) {
				shape.push(...fromShape);
			}
			continue;
		}
		if (typeof parsed === 'string') {
			shape.push(parsed);
		}
	}

	if (shape.length === 0) {
		return undefined;
	}
	return { head, shape };
}

function sourcePreview(source: unknown): string {
	if (typeof source === 'string') {
		return source
			.slice(0, 160)
			.replaceAll(/\s+/g, ' ')
			.trim();
	}
	try {
		return JSON.stringify(source).slice(0, 160);
	}
	catch {
		return String(source).slice(0, 160);
	}
}

function buildExtractDiagnostics(documentSource: unknown, parsed: unknown): string {
	const sourceType = Array.isArray(documentSource) ? 'array' : typeof documentSource;
	const rootType = Array.isArray(parsed) ? 'array' : typeof parsed;
	const keys = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
		? Object.keys(parsed as Record<string, unknown>).slice(0, 16).join(',')
		: '';
	return `sourceType=${sourceType} root=${rootType}${keys ? ` keys=[${keys}]` : ''} preview="${sourcePreview(documentSource)}"`;
}

export function extractHeadAndShape(documentSource: unknown): ExtractedHeadAndShape {
	let parsed: unknown;
	let pipeSegments: PipeSourceSegments | undefined;
	if (typeof documentSource === 'string') {
		try {
			parsed = JSON.parse(documentSource);
		}
		catch {
			pipeSegments = parsePipeSource(documentSource);
			if (!pipeSegments) {
				throw new Error(`Document source is not valid JSON; preview="${sourcePreview(documentSource)}"`);
			}
			parsed = pipeSegments.parsed;
		}
	}
	else {
		parsed = documentSource;
	}

	const found = findHeadAndShape(parsed, 8);
	if (!found && pipeSegments) {
		const fromPipe = extractFromPipeSegments(pipeSegments);
		if (fromPipe) {
			return fromPipe;
		}
	}
	if (!found) {
		throw new Error(`Unable to find { head, shape[] } in document source; ${buildExtractDiagnostics(documentSource, parsed)}`);
	}
	return found;
}
